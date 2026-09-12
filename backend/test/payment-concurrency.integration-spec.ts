import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentsService } from '../src/payments/payments.service';
import { ReservationsService } from '../src/reservations/reservations.service';
import { RoomsService } from '../src/rooms/rooms.service';
import { Client } from 'pg';

// This suite must only run through the disposable-container runner.
if (
  process.env.PAYMENT_INTEGRATION_ISOLATED !== '1' ||
  new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !==
    '/mhc_payment_test'
) {
  throw new Error(
    'Use npm run test:payments:integration (isolated database required)',
  );
}

jest.setTimeout(30000);

describe('Payment concurrency with real PostgreSQL advisory locks', () => {
  let prisma: PrismaService;
  let payments: PaymentsService;
  let reservations: ReservationsService;
  let rooms: RoomsService;
  const refund = jest.fn();

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    payments = new PaymentsService(
      new ConfigService({ STRIPE_SECRET_KEY: 'sk_test_unused' }),
      prisma,
    );
    reservations = new ReservationsService(prisma);
    rooms = new RoomsService(prisma);
    // No network calls to Stripe. Database transactions and locks remain real.
    (payments as unknown as { stripe: unknown }).stripe = {
      refunds: { create: refund },
      paymentIntents: {
        create: jest.fn(() => {
          throw new Error('Unexpected external payment creation');
        }),
      },
    };
  });
  beforeEach(() =>
    refund
      .mockReset()
      .mockResolvedValue({ id: 're_test', status: 'succeeded' }),
  );
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function fixture(expired = true) {
    const user = await prisma.user.create({
      data: {
        email: `${randomUUID()}@integration.invalid`,
        passwordHash: 'unused',
        doctorProfile: {
          create: { firstName: 'Integration', lastName: 'Doctor' },
        },
      },
      include: { doctorProfile: true },
    });
    const room = await prisma.room.create({
      data: { name: 'Integration room', pricePerHour: 350 },
    });
    const day = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const reservation = await prisma.reservation.create({
      data: {
        roomId: room.id,
        doctorId: user.doctorProfile!.id,
        startTime: new Date(`${day}T14:00:00Z`),
        endTime: new Date(`${day}T15:00:00Z`),
        totalPrice: 350,
        expiresAt: new Date(Date.now() + (expired ? -60000 : 60000)),
      },
    });
    const payment = await prisma.payment.create({
      data: {
        reservationId: reservation.id,
        amount: 350,
        provider: 'stripe',
        transactionId: `pi_${randomUUID()}`,
      },
    });
    const event = {
      id: `evt_${randomUUID()}`,
      type: 'payment_intent.succeeded',
      created: Math.floor(
        (Math.min(Date.now(), reservation.expiresAt!.getTime()) - 10000) / 1000,
      ),
      data: {
        object: { id: payment.transactionId!, amount: 35000, currency: 'mxn' },
      },
    } as Stripe.Event;
    return { user, room, reservation, payment, event };
  }

  type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown };

  // Hold the actual DB lock until every competing operation is visibly waiting.
  // This forces overlap without guessing timing using a fixed sleep.
  async function queued(
    roomId: string,
    operations: Array<() => Promise<unknown>>,
  ) {
    const gate = new Client({ connectionString: process.env.DATABASE_URL });
    const results: Array<Promise<Outcome>> = [];
    await gate.connect();
    try {
      await gate.query('BEGIN');
      await gate.query('SELECT pg_advisory_xact_lock(hashtext($1))', [roomId]);
      for (const operation of operations) {
        results.push(
          operation().then(
            (value) => ({ ok: true as const, value }),
            (error) => ({ ok: false as const, error }),
          ),
        );
        const deadline = Date.now() + 3000;
        while (true) {
          const result = await gate.query(
            "SELECT count(*)::int AS count FROM pg_locks WHERE locktype = 'advisory' AND NOT granted",
          );
          if (result.rows[0].count >= results.length) break;
          if (Date.now() >= deadline)
            throw new Error(
              'Operation did not wait for the room advisory lock',
            );
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      await gate.query('COMMIT');
      return await Promise.all(results);
    } finally {
      await gate.query('ROLLBACK').catch(() => {});
      await gate.end();
      await Promise.allSettled(results);
    }
  }

  async function state(id: string) {
    return prisma.reservation.findUniqueOrThrow({
      where: { id },
      include: { payment: true },
    });
  }

  it('refunds an on-time payment whose delayed webhook encounters an administrative block', async () => {
    const f = await fixture();
    await rooms.createBlock(f.room.id, {
      startTime: f.reservation.startTime.toISOString(),
      endTime: f.reservation.endTime.toISOString(),
      reason: 'Maintenance',
    });
    await payments.handleStripeWebhook(f.event);
    expect(await state(f.reservation.id)).toMatchObject({
      status: 'EXPIRED',
      payment: { status: 'REFUNDED' },
    });
    expect(refund).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    'serializes block versus confirmation (block first: %s)',
    async (blockFirst) => {
      const f = await fixture();
      const block = () =>
        rooms.createBlock(f.room.id, {
          startTime: f.reservation.startTime.toISOString(),
          endTime: f.reservation.endTime.toISOString(),
        });
      const confirm = () => payments.handleStripeWebhook(f.event);
      const results = await queued(
        f.room.id,
        blockFirst ? [block, confirm] : [confirm, block],
      );
      expect(results[0].ok).toBe(true);
      expect(results[1].ok).toBe(blockFirst);
      expect(await state(f.reservation.id)).toMatchObject(
        blockFirst
          ? { status: 'EXPIRED', payment: { status: 'REFUNDED' } }
          : { status: 'CONFIRMED', payment: { status: 'PAID' } },
      );
    },
  );

  it('does not resurrect a reservation cancelled while its webhook waits', async () => {
    const f = await fixture(false);
    const results = await queued(f.room.id, [
      () => reservations.cancel(f.user.id, f.reservation.id),
      () => payments.handleStripeWebhook(f.event),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await state(f.reservation.id)).toMatchObject({
      status: 'CANCELLED',
      payment: { status: 'REFUNDED' },
    });
  });

  it('does not expire a reservation confirmed while an expired-hold request waits', async () => {
    const f = await fixture();
    const results = await queued(f.room.id, [
      () => payments.handleStripeWebhook(f.event),
      () => payments.createPaymentIntent(f.user.id, f.reservation.id),
    ]);
    expect(results.map((result) => result.ok)).toEqual([true, false]);
    expect(await state(f.reservation.id)).toMatchObject({
      status: 'CONFIRMED',
      payment: { status: 'PAID' },
    });
  });

  it('does not overwrite cancellation with expired status', async () => {
    const f = await fixture();
    const results = await queued(f.room.id, [
      () => reservations.cancel(f.user.id, f.reservation.id),
      () => payments.createPaymentIntent(f.user.id, f.reservation.id),
    ]);
    expect(results.map((result) => result.ok)).toEqual([true, false]);
    expect((await state(f.reservation.id)).status).toBe('CANCELLED');
  });

  it.each([true, false])(
    'has one occupant when confirmation races a replacement (confirmation first: %s)',
    async (confirmationFirst) => {
      const f = await fixture();
      const confirm = () => payments.handleStripeWebhook(f.event);
      const replace = () =>
        reservations.create(f.user.id, {
          roomId: f.room.id,
          startTime: f.reservation.startTime.toISOString(),
          endTime: f.reservation.endTime.toISOString(),
        });
      const results = await queued(
        f.room.id,
        confirmationFirst ? [confirm, replace] : [replace, confirm],
      );
      expect(results.map((result) => result.ok)).toEqual([
        true,
        !confirmationFirst,
      ]);
      expect(
        await prisma.reservation.count({
          where: {
            roomId: f.room.id,
            OR: [
              { status: 'CONFIRMED' },
              { status: 'PENDING', expiresAt: { gt: new Date() } },
            ],
          },
        }),
      ).toBe(1);
      expect(await state(f.reservation.id)).toMatchObject(
        confirmationFirst
          ? { status: 'CONFIRMED', payment: { status: 'PAID' } }
          : { status: 'EXPIRED', payment: { status: 'REFUNDED' } },
      );
    },
  );

  it('retains exactly one winner for twenty concurrent reservation requests', async () => {
    const f = await fixture();
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        reservations.create(f.user.id, {
          roomId: f.room.id,
          startTime: f.reservation.startTime.toISOString(),
          endTime: f.reservation.endTime.toISOString(),
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const failures = results.filter((result) => result.status === 'rejected');
    expect(failures).toHaveLength(19);
    for (const failure of failures) {
      expect(failure.reason.getStatus()).toBe(400);
    }
    expect(
      await prisma.reservation.count({
        where: {
          roomId: f.room.id,
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
      }),
    ).toBe(1);
  });

  it.each(['payment_intent.payment_failed', 'payment_intent.canceled'])(
    'does not let delayed %s downgrade PAID or REFUNDED',
    async (type) => {
      for (const status of ['PAID', 'REFUNDED'] as const) {
        const f = await fixture();
        await prisma.payment.update({
          where: { id: f.payment.id },
          data: { status },
        });
        await payments.handleStripeWebhook({
          ...f.event,
          type,
        } as Stripe.Event);
        expect((await state(f.reservation.id)).payment!.status).toBe(status);
      }
    },
  );

  it('allows a failed attempt to recover when a later attempt succeeds', async () => {
    const f = await fixture(false);
    await payments.handleStripeWebhook({
      ...f.event,
      id: `evt_${randomUUID()}`,
      type: 'payment_intent.payment_failed',
    } as Stripe.Event);
    expect((await state(f.reservation.id)).payment!.status).toBe('FAILED');
    await payments.handleStripeWebhook(f.event);
    expect(await state(f.reservation.id)).toMatchObject({
      status: 'CONFIRMED',
      payment: { status: 'PAID' },
    });
  });

  it('deduplicates the same event with the real database unique constraint', async () => {
    const f = await fixture(false);
    const results = await Promise.all([
      payments.handleStripeWebhook(f.event),
      payments.handleStripeWebhook(f.event),
    ]);
    expect(results.filter((result) => result.duplicate)).toHaveLength(1);
    expect(await state(f.reservation.id)).toMatchObject({
      status: 'CONFIRMED',
      payment: { status: 'PAID' },
    });
    expect(
      await prisma.stripeWebhookEvent.count({ where: { id: f.event.id } }),
    ).toBe(1);
  });

  it('does not refund twice for concurrent distinct success events about a cancelled reservation', async () => {
    const f = await fixture();
    await reservations.cancel(f.user.id, f.reservation.id);
    const results = await queued(f.room.id, [
      () => payments.handleStripeWebhook(f.event),
      () =>
        payments.handleStripeWebhook({ ...f.event, id: `evt_${randomUUID()}` }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(refund).toHaveBeenCalledTimes(1);
    expect(await state(f.reservation.id)).toMatchObject({
      status: 'CANCELLED',
      payment: { status: 'REFUNDED' },
    });
  });
});
