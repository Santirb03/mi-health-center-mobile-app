import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const options = { timeout: 5000, maxNetworkRetries: 0 };
const refundStates = new Set(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']);
export const refundSummarySelection = {
  status: true,
  refunds: { select: { amount: true, status: true } },
  refundSync: { select: { automatic: true, lastCheckedAt: true, needsReview: true, lastError: true } },
} as const;

export async function enqueueRefundSync(tx: Prisma.TransactionClient, paymentId: string, automatic = false) {
  return tx.refundSync.upsert({ where: { paymentId },
    create: { paymentId, automatic },
    update: { nextAttemptAt: new Date(), version: { increment: 1 }, ...(automatic ? { automatic: true } : {}) },
  });
}

// A durable DB job and a short lease serialize workers. No Stripe I/O runs
// inside a PostgreSQL transaction. A crash is recovered by lease expiry.
export class RefundReconciler {
  constructor(private readonly prisma: PrismaService, private readonly stripe: Stripe) {}

  async forIntent(intentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { transactionId: intentId } });
    if (!payment) return;
    const job = await this.prisma.refundSync.findUnique({ where: { paymentId: payment.id } });
    if (job) await this.run(job.id);
  }

  async run(id: string) {
    const token = randomUUID();
    const now = new Date();
    const claimed = await this.prisma.refundSync.updateMany({
      where: { id, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      data: { leaseToken: token, leaseUntil: new Date(now.getTime() + 120000) },
    });
    if (!claimed.count) return;
    try {
      const job = await this.prisma.refundSync.findUniqueOrThrow({ where: { id }, include: { payment: { include: { reservation: true } } } });
      const payment = job.payment;
      if (!payment.transactionId) throw new Error('missing_payment_intent');
      const refunds: Stripe.Refund[] = [];
      let after: string | undefined;
      // Bounded pagination: refuse to make financial decisions on a partial list.
      for (let page = 0; page < 10; page++) {
        const result = await this.stripe.refunds.list({ payment_intent: payment.transactionId, limit: 100, ...(after ? { starting_after: after } : {}) }, options);
        refunds.push(...result.data);
        if (!result.has_more) break;
        if (!result.data.length || page === 9) throw new Error('refund_list_incomplete');
        after = result.data.at(-1)!.id;
      }
      let review = false;
      let reason: string | null = null;
      if (job.automatic && refunds.length === 0) {
        // Stripe may have accepted an earlier request whose response was lost.
        // Never reuse a possibly expired key to blindly issue another refund.
        if (job.attemptedAt && now.getTime() - job.attemptedAt.getTime() >= 20 * 3600000) {
          review = true; reason = 'ambiguous_old_attempt';
        } else {
          const authorized = await this.prisma.refundSync.updateMany({
            where: { id, leaseToken: token }, data: { attemptedAt: job.attemptedAt ?? new Date() },
          });
          if (!authorized.count) return;
          refunds.push(await this.stripe.refunds.create({
            payment_intent: payment.transactionId,
            amount: Math.round(Number(payment.amount) * 100),
            metadata: { refundOperationId: id },
          }, { ...options, idempotencyKey: `reservation-auto-refund-${id}` }));
        }
      }
      for (const refund of refunds) {
        const intent = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id;
        if (intent !== payment.transactionId || refund.currency !== 'mxn' || !refundStates.has(refund.status ?? '') || !Number.isSafeInteger(refund.amount) || refund.amount <= 0) {
          throw new Error('invalid_refund_snapshot');
        }
      }
      const succeeded = refunds.filter(r => r.status === 'succeeded').reduce((sum, r) => sum + r.amount, 0);
      const total = Math.round(Number(payment.amount) * 100);
      if (succeeded > total) throw new Error('refund_total_exceeds_payment');
      const outstanding = refunds.some(r => r.status === 'pending' || r.status === 'requires_action');
      if (refunds.some(r => r.status === 'failed' || r.status === 'canceled' || r.status === 'requires_action')) { review = true; reason = 'refund_needs_attention'; }
      // External/partial refunds satisfy only their actual amounts. Do not
      // invent a policy to automatically refund the remainder.
      if (job.automatic && refunds.length && !outstanding && succeeded < total) { review = true; reason ??= 'automatic_refund_incomplete'; }
      await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${payment.reservation.roomId}))`;
        const fresh = await tx.refundSync.findUniqueOrThrow({ where: { id } });
        if (fresh.leaseToken !== token) return;
        const doctor = await tx.doctorProfile.findUniqueOrThrow({ where: { id: payment.reservation.doctorId } });
        for (const refund of refunds) {
          const data = { paymentId: payment.id, amount: refund.amount, status: refund.status!, failureReason: refund.failure_reason ?? null, createdAt: new Date(refund.created * 1000) };
          await tx.refund.upsert({ where: { id: refund.id }, create: { id: refund.id, ...data }, update: data });
          const titles: Record<string, string> = { pending: 'Reembolso pendiente', requires_action: 'Reembolso requiere atención', succeeded: 'Reembolso procesado', failed: 'Reembolso no completado', canceled: 'Reembolso cancelado' };
          await tx.notification.createMany({ skipDuplicates: true, data: [{
            userId: doctor.userId, reservationId: payment.reservationId, eventKey: `refund:${refund.id}:${refund.status}`,
            title: titles[refund.status!], body: refund.status === 'succeeded'
              ? 'Stripe procesó el reembolso. El tiempo para verlo reflejado depende de tu banco.'
              : 'Consulta el estado de tu pago o contacta a administración. Este aviso no confirma una devolución completada.',
          }] });
        }
        // A stale snapshot is never marked current if another event arrived
        // during I/O; the next worker immediately refreshes it again.
        await tx.refundSync.update({ where: { id }, data: {
          leaseToken: null, leaseUntil: null, lastCheckedAt: new Date(), needsReview: review, lastError: reason,
          nextAttemptAt: new Date(Date.now() + (fresh.version !== job.version ? 0 : outstanding ? 60000 : 900000)),
        } });
        // A refund event can arrive before payment_intent.succeeded. Keep the
        // pending payment eligible for its confirmation webhook; refund details
        // are already persisted and will be reconciled after that webhook.
        if ((refunds.length || payment.status === 'REFUNDED') && (payment.status === 'PAID' || payment.status === 'REFUNDED')) {
          await tx.payment.update({ where: { id: payment.id }, data: { status: succeeded >= total ? 'REFUNDED' : 'PAID' } });
        }
      }, { maxWait: 5000, timeout: 5000 });
    } catch {
      // No Stripe error messages: they may contain customer/provider details.
      await this.prisma.refundSync.updateMany({ where: { id, leaseToken: token }, data: {
        leaseToken: null, leaseUntil: null, nextAttemptAt: new Date(Date.now() + 60000), lastError: 'reconciliation_failed', needsReview: true,
      } });
      throw new Error('Refund reconciliation failed; durable retry scheduled');
    }
  }
}
