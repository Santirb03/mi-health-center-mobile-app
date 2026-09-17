import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AgendaQueryDto } from './dto/agenda-query.dto';

export function agendaDay(date: string) {
  const midnight = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(midnight.getTime()) ||
    midnight.toISOString().slice(0, 10) !== date
  ) {
    throw new BadRequestException('Invalid calendar date');
  }
  // Same UTC-06 business day used by booking and availability.
  const start = new Date(`${date}T00:00:00-06:00`);
  return { start, end: new Date(start.getTime() + 86400000) };
}

@Injectable()
export class AdminAgendaService {
  constructor(private readonly prisma: PrismaService) {}

  rooms() {
    return this.prisma.room.findMany({
      select: { id: true, name: true, active: true, description: true, pricePerHour: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  async list(query: AgendaQueryDto) {
    const { start, end } = agendaDay(query.date);
    const now = new Date();
    const where: Prisma.ReservationWhereInput = {
      startTime: { lt: end },
      endTime: { gt: start },
      ...(query.roomId ? { roomId: query.roomId } : {}),
    };
    // Expired holds are a read projection only: do not interfere with late webhooks.
    if (query.status === 'PENDING') {
      where.status = 'PENDING';
      where.expiresAt = { gt: now };
    } else if (query.status === 'EXPIRED') {
      where.OR = [
        { status: 'EXPIRED' },
        {
          status: 'PENDING',
          OR: [{ expiresAt: { lte: now } }, { expiresAt: null }],
        },
      ];
    } else if (query.status) where.status = query.status;
    const page = query.page ?? 1;
    const pageSize = 50;
    const rows = await this.prisma.reservation.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize + 1,
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        startTime: true,
        endTime: true,
        status: true,
        expiresAt: true,
        totalPrice: true,
        room: { select: { id: true, name: true, active: true } },
        doctor: { select: { firstName: true, lastName: true } },
        payment: { select: { status: true } },
      },
    });
    return {
      date: query.date,
      timeZone: 'America/Mexico_City',
      page,
      pageSize,
      hasMore: rows.length > pageSize,
      items: rows
        .slice(0, pageSize)
        .map((row) => ({
          ...row,
          displayStatus:
            row.status === 'PENDING' && (!row.expiresAt || row.expiresAt <= now)
              ? 'EXPIRED'
              : row.status,
        })),
    };
  }
}
