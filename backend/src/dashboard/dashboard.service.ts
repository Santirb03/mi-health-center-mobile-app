import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { agendaDay } from '../reservations/admin-agenda.service';
import { OPENING_HOUR, CLOSING_HOUR } from '../reservations/reservations.service';
import { availableMinutes, decimalCents, formatCents, utilizationBp } from './dashboard.metrics';
import type { Interval, OperatingDay } from './dashboard.metrics';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

type ReservationMetrics = {
  roomId: string; confirmed: number; completed: number; cancelled: number;
  expired: number; pendingActive: number; cancelledWithPayment: number; bookedMinutes: number;
};
type RevenueMetrics = { roomId: string; paid: string; refunded: string };

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  range(query: DashboardQueryDto) {
    const start = agendaDay(query.from).start;
    const end = agendaDay(query.to).end;
    const days = (end.getTime() - start.getTime()) / 86400000;
    if (days < 1) throw new BadRequestException('Invalid dashboard range');
    if (days > 62) throw new BadRequestException('Dashboard range too large');
    const windows: OperatingDay[] = Array.from({ length: days }, (_, index) => {
      const dayStart = start.getTime() + index * 86400000;
      return { start: dayStart, end: dayStart + 86400000,
        opens: dayStart + OPENING_HOUR * 3600000, closes: dayStart + CLOSING_HOUR * 3600000 };
    });
    return { start, end, days, windows };
  }

  async get(query: DashboardQueryDto) {
    const now = new Date();
    const { start, end, days, windows } = this.range(query);
    // Counts use reservation startTime. Booked minutes use CONFIRMED/COMPLETED,
    // clipped to each operating window, never pending holds or blocked capacity.
    // Revenue follows paidAt of the original PAID/REFUNDED payment: a later
    // succeeded refund changes that historical period's net. This is net of
    // collected payments, not movement-date cash flow, profit, fees or taxes.
    // Current inactive rooms have zero offered capacity and null utilization;
    // no activation history exists, so historical capacity cannot be reconstructed.
    // One repeatable-read snapshot prevents mismatched counts/amounts during writes.
    return this.prisma.$transaction(async tx => {
      const reservations = await tx.$queryRaw<ReservationMetrics[]>(Prisma.sql`
        WITH selected AS (
          SELECT * FROM reservations WHERE "startTime" >= ${start} AND "startTime" < ${end}
        ), booked AS (
          SELECT r."roomId", FLOOR(SUM(EXTRACT(EPOCH FROM
            (LEAST(r."endTime", d.day + ${CLOSING_HOUR} * INTERVAL '1 hour') -
             GREATEST(r."startTime", d.day + ${OPENING_HOUR} * INTERVAL '1 hour'))) / 60))::int AS minutes
          FROM selected r
          JOIN generate_series(${start}::timestamp, ${end}::timestamp - INTERVAL '1 day', INTERVAL '1 day') d(day)
            ON r."startTime" < d.day + ${CLOSING_HOUR} * INTERVAL '1 hour'
           AND r."endTime" > d.day + ${OPENING_HOUR} * INTERVAL '1 hour'
          WHERE r.status IN ('CONFIRMED', 'COMPLETED')
          GROUP BY r."roomId"
        )
        SELECT r."roomId",
          COUNT(*) FILTER (WHERE r.status = 'CONFIRMED')::int AS confirmed,
          COUNT(*) FILTER (WHERE r.status = 'COMPLETED')::int AS completed,
          COUNT(*) FILTER (WHERE r.status = 'CANCELLED')::int AS cancelled,
          COUNT(*) FILTER (WHERE r.status = 'EXPIRED' OR (r.status = 'PENDING' AND (r."expiresAt" <= ${now} OR r."expiresAt" IS NULL)))::int AS expired,
          COUNT(*) FILTER (WHERE r.status = 'PENDING' AND r."expiresAt" > ${now})::int AS "pendingActive",
          COUNT(*) FILTER (WHERE r.status = 'CANCELLED' AND EXISTS (
            SELECT 1 FROM payments p WHERE p."reservationId" = r.id AND p.status IN ('PAID', 'REFUNDED')
          ))::int AS "cancelledWithPayment",
          COALESCE(MAX(b.minutes), 0)::int AS "bookedMinutes"
        FROM selected r LEFT JOIN booked b ON b."roomId" = r."roomId" GROUP BY r."roomId"
      `);
      // Pre-aggregate refunds per payment: multiple refunds cannot multiply gross.
      const revenue = await tx.$queryRaw<RevenueMetrics[]>(Prisma.sql`
        WITH eligible AS (
          SELECT p.id, p.amount, r."roomId" FROM payments p
          JOIN reservations r ON r.id = p."reservationId"
          WHERE p.status IN ('PAID', 'REFUNDED') AND p."paidAt" >= ${start} AND p."paidAt" < ${end}
        ), returned AS (
          SELECT f."paymentId", SUM(f.amount) AS cents FROM refunds f
          JOIN eligible e ON e.id = f."paymentId" WHERE f.status = 'succeeded' GROUP BY f."paymentId"
        )
        SELECT e."roomId", SUM(e.amount)::text AS paid,
          COALESCE(SUM(f.cents), 0)::text AS refunded
        FROM eligible e LEFT JOIN returned f ON f."paymentId" = e.id GROUP BY e."roomId"
      `);
      const relevant = [...new Set([...reservations, ...revenue].map(row => row.roomId))];
      const rooms = await tx.room.findMany({ where: { OR: [{ active: true }, { id: { in: relevant } }] },
        select: { id: true, name: true, active: true, createdAt: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
      const blocks = await tx.roomBlock.findMany({ where: {
        roomId: { in: rooms.filter(room => room.active).map(room => room.id) },
        startTime: { lt: end }, endTime: { gt: start },
      }, select: { roomId: true, startTime: true, endTime: true } });
      const blocksByRoom = new Map<string, Interval[]>();
      for (const block of blocks) {
        const intervals = blocksByRoom.get(block.roomId) ?? [];
        intervals.push({ start: block.startTime.getTime(), end: block.endTime.getTime() });
        blocksByRoom.set(block.roomId, intervals);
      }
      const reservationsByRoom = new Map(reservations.map(row => [row.roomId, row]));
      const revenueByRoom = new Map(revenue.map(row => [row.roomId, row]));
      const counts = { confirmed: 0, completed: 0, cancelled: 0, expired: 0, pendingActive: 0 };
      let cancelledWithPayment = 0;
      for (const row of reservations) {
        for (const key of Object.keys(counts) as Array<keyof typeof counts>) counts[key] += row[key];
        cancelledWithPayment += row.cancelledWithPayment;
      }
      let paid = 0n, refunded = 0n;
      const roomMetrics = rooms.map(room => {
        const financial = revenueByRoom.get(room.id);
        const gross = decimalCents(financial?.paid ?? '0');
        const returned = BigInt(financial?.refunded ?? '0');
        paid += gross; refunded += returned;
        const booked = reservationsByRoom.get(room.id)?.bookedMinutes ?? 0;
        const available = availableMinutes(room.active, room.createdAt.getTime(), windows, blocksByRoom.get(room.id) ?? []);
        return { roomId: room.id, name: room.name, active: room.active,
          bookedMinutes: booked, availableMinutes: available, utilizationBp: utilizationBp(booked, available),
          paid: formatCents(gross), net: formatCents(gross - returned) };
      });
      return { range: { from: query.from, to: query.to, days }, reservations: counts,
        cancellations: { cancelled: counts.cancelled, cancelledWithPayment },
        revenue: { paid: formatCents(paid), refunded: formatCents(refunded), net: formatCents(paid - refunded) },
        rooms: roomMetrics, generatedAt: now.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
