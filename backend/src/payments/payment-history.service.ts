import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { refundSummarySelection } from './refunds';
import { PaymentHistoryDto } from './dto/payment-history.dto';

export function decimalCents(value: Prisma.Decimal | string): bigint {
  const text = typeof value === 'string' ? value : value.toFixed(2);
  const parts = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!parts) throw new Error('Invalid decimal amount');
  const cents = BigInt(parts[2]) * 100n + BigInt((parts[3] ?? '').padEnd(2, '0'));
  return parts[1] ? -cents : cents;
}

export function formatCents(cents: bigint): string {
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

function decodeCursor(value: string) {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) throw new Error();
    const cursor = JSON.parse(bytes.toString('utf8'));
    if (!cursor || Object.keys(cursor).sort().join(',') !== 'id,time'
      || typeof cursor.id !== 'string' || !isUUID(cursor.id)
      || typeof cursor.time !== 'string' || new Date(cursor.time).toISOString() !== cursor.time) {
      throw new Error();
    }
    return { id: cursor.id as string, time: new Date(cursor.time) };
  } catch {
    throw new BadRequestException('Invalid payment cursor');
  }
}

@Injectable()
export class PaymentHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async history(userId: string, query: PaymentHistoryDto) {
    const doctor = await this.prisma.doctorProfile.findUnique({ where: { userId } });
    if (!doctor) throw new NotFoundException('Doctor profile not found');
    const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor);
    const eligible: Prisma.PaymentWhereInput = {
      reservation: { doctorId: doctor.id }, status: { in: ['PAID', 'REFUNDED'] },
    };
    // One snapshot keeps both global sums and the first page consistent during webhook writes.
    return this.prisma.$transaction(async tx => {
      const rows = await tx.payment.findMany({
        where: { AND: [eligible, ...(cursor ? [{ OR: [
          { createdAt: { lt: cursor.time } },
          { createdAt: cursor.time, id: { lt: cursor.id } },
        ] }] : [])] },
        select: {
          ...refundSummarySelection,
          id: true, reservationId: true, amount: true, paidAt: true, createdAt: true,
          reservation: { select: {
            id: true, startTime: true, endTime: true, status: true,
            room: { select: { id: true, name: true } },
          } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 21,
      });
      const page = rows.slice(0, 20);
      const last = page.at(-1);
      const nextCursor = rows.length > 20 && last
        ? Buffer.from(JSON.stringify({ id: last.id, time: last.createdAt.toISOString() })).toString('base64url')
        : null;
      let totals: { paid: string; refunded: string; net: string } | null = null;
      if (!cursor) {
        const paidSum = await tx.payment.aggregate({ where: eligible, _sum: { amount: true } });
        // SUM(Int) is bigint in PostgreSQL; cast to text to avoid any JS number conversion.
        const refundSum = await tx.$queryRaw<Array<{ amount: string | null }>>`
          SELECT SUM(r.amount)::text AS amount
          FROM refunds r JOIN payments p ON p.id = r."paymentId"
          JOIN reservations b ON b.id = p."reservationId"
          WHERE b."doctorId" = ${doctor.id} AND r.status = 'succeeded'
        `;
        const paid = paidSum._sum.amount === null ? 0n : decimalCents(paidSum._sum.amount);
        const refunded = BigInt(refundSum[0]?.amount ?? '0');
        totals = { paid: formatCents(paid), refunded: formatCents(refunded), net: formatCents(paid - refunded) };
      }
      return {
        items: page.map(row => ({
          ...row, amount: formatCents(decimalCents(row.amount)),
          paidAt: row.paidAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(),
          reservation: { ...row.reservation,
            startTime: row.reservation.startTime.toISOString(), endTime: row.reservation.endTime.toISOString(),
          },
        })), nextCursor, totals,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
