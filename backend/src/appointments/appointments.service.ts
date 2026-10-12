import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAppointmentDto, RescheduleAppointmentDto, AppointmentPageDto, AppointmentCalendarDto } from './dto/appointment.dto';
import { appointmentInterval, calendarBounds, decodeCursor, encodeCursor, requireContainment } from './appointment-rules';
import { appointmentSelection, appointmentView } from './appointment-view';
import { isExclusionViolation } from './exclusion-error';

@Injectable()
export class AppointmentsService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireDoctorId(userId: string) {
    const doctor = await this.prisma.doctorProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!doctor) throw new NotFoundException('Doctor profile not found');
    return doctor.id;
  }
  private async write<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(work, { maxWait: 10000, timeout: 15000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (isExclusionViolation(error)) throw new ConflictException('Appointment overlaps another appointment');
      throw error;
    }
  }
  private async lockDoctor(tx: Prisma.TransactionClient, doctorId: string, userId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7101, hashtext(${doctorId}))`;
    if (!await tx.doctorProfile.findFirst({ where: { id: doctorId, userId }, select: { id: true } }))
      throw new NotFoundException('Doctor profile not found');
  }
  private async lockReservation(tx: Prisma.TransactionClient, doctorId: string, reservationId: string, oldRoomId?: string | null) {
    const reference = await tx.reservation.findFirst({ where: { id: reservationId, doctorId } });
    if (!reference) throw new NotFoundException('Reservation not found');
    // Doctor first, then room locks in PostgreSQL hash-key order. This also handles
    // hash collisions deterministically; reservation mutations only hold one room.
    const roomIds = [...new Set([reference.roomId, ...(oldRoomId ? [oldRoomId] : [])])];
    const rooms = await tx.$queryRaw<{ roomId: string }[]>(Prisma.sql`
      SELECT value AS "roomId" FROM unnest(ARRAY[${Prisma.join(roomIds)}]::text[]) AS value
      ORDER BY hashtext(value), value
    `);
    for (const room of rooms)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${room.roomId}))`;
    const reservation = await tx.reservation.findFirst({ where: { id: reservationId, doctorId } });
    if (!reservation) throw new NotFoundException('Reservation not found');
    if (reservation.roomId !== reference.roomId) throw new ConflictException('Reservation changed; retry appointment');
    if (reservation.status !== 'CONFIRMED') throw new ConflictException('Reservation must be confirmed');
    return reservation;
  }
  private async requirePatient(tx: Prisma.TransactionClient, patientId: string, doctorId: string) {
    if (!await tx.patient.findFirst({ where: { id: patientId, doctorId }, select: { id: true } }))
      throw new NotFoundException('Patient not found');
  }
  private async checkOverlap(tx: Prisma.TransactionClient, doctorId: string, startTime: Date, endTime: Date, except?: string) {
    const conflict = await tx.appointment.findFirst({ where: {
      doctorId, status: { not: 'CANCELLED' }, startTime: { lt: endTime }, endTime: { gt: startTime },
      ...(except ? { id: { not: except } } : {}),
    }, select: { id: true } });
    if (conflict) throw new ConflictException('Appointment overlaps another appointment');
  }
  async create(userId: string, dto: CreateAppointmentDto) {
    const doctorId = await this.requireDoctorId(userId);
    return this.write(async tx => {
      await this.lockDoctor(tx, doctorId, userId);
      const reservation = await this.lockReservation(tx, doctorId, dto.reservationId);
      await this.requirePatient(tx, dto.patientId, doctorId);
      const interval = appointmentInterval(dto.startTime, dto.endTime, new Date());
      requireContainment(interval.startTime, interval.endTime, reservation);
      await this.checkOverlap(tx, doctorId, interval.startTime, interval.endTime);
      return appointmentView(await tx.appointment.create({ data: {
        doctorId, patientId: dto.patientId, reservationId: reservation.id, roomId: reservation.roomId,
        ...interval, status: 'SCHEDULED',
      }, select: appointmentSelection }));
    });
  }
  async reschedule(userId: string, id: string, dto: RescheduleAppointmentDto) {
    const doctorId = await this.requireDoctorId(userId);
    return this.write(async tx => {
      await this.lockDoctor(tx, doctorId, userId);
      const current = await tx.appointment.findFirst({ where: { id, doctorId } });
      if (!current) throw new NotFoundException('Appointment not found');
      if (current.status !== 'SCHEDULED' || current.startTime <= new Date())
        throw new ConflictException('Appointment cannot be rescheduled');
      const reservationId = dto.reservationId ?? current.reservationId;
      if (!reservationId) throw new BadRequestException('Reservation required for rescheduling');
      const reservation = await this.lockReservation(tx, doctorId, reservationId, current.roomId);
      const now = new Date();
      if (current.status !== 'SCHEDULED' || current.startTime <= now)
        throw new ConflictException('Appointment cannot be rescheduled');
      await this.requirePatient(tx, current.patientId, doctorId);
      const interval = appointmentInterval(dto.startTime, dto.endTime, now);
      requireContainment(interval.startTime, interval.endTime, reservation);
      await this.checkOverlap(tx, doctorId, interval.startTime, interval.endTime, id);
      const changed = await tx.appointment.updateMany({ where: { id, doctorId, status: 'SCHEDULED',
        startTime: { gt: now } }, data: { ...interval, reservationId, roomId: reservation.roomId } });
      if (changed.count !== 1) throw new ConflictException('Appointment cannot be rescheduled');
      return this.readView(tx, doctorId, id);
    });
  }
  private async readView(tx: Prisma.TransactionClient, doctorId: string, id: string) {
    const row = await tx.appointment.findFirst({ where: { id, doctorId }, select: appointmentSelection });
    if (!row) throw new NotFoundException('Appointment not found');
    return appointmentView(row);
  }
  async findOne(userId: string, id: string) {
    return this.readView(this.prisma, await this.requireDoctorId(userId), id);
  }
  private async transition(userId: string, id: string, target: 'CANCELLED' | 'COMPLETED') {
    const doctorId = await this.requireDoctorId(userId);
    return this.write(async tx => {
      await this.lockDoctor(tx, doctorId, userId);
      const current = await tx.appointment.findFirst({ where: { id, doctorId }, select: appointmentSelection });
      if (!current) throw new NotFoundException('Appointment not found');
      if (current.status === target) return appointmentView(current);
      const now = new Date();
      if (current.status !== 'SCHEDULED' || (target === 'COMPLETED' && now < current.startTime))
        throw new ConflictException('Appointment cannot change status');
      const changed = await tx.appointment.updateMany({ where: { id, doctorId, status: 'SCHEDULED',
        ...(target === 'COMPLETED' ? { startTime: { lte: now } } : {}) }, data: { status: target } });
      if (changed.count !== 1) throw new ConflictException('Appointment cannot change status');
      return this.readView(tx, doctorId, id);
    });
  }
  cancel(userId: string, id: string) { return this.transition(userId, id, 'CANCELLED'); }
  complete(userId: string, id: string) { return this.transition(userId, id, 'COMPLETED'); }
  async page(userId: string, query: AppointmentPageDto) {
    const doctorId = await this.requireDoctorId(userId);
    if (query.patientId) await this.requirePatient(this.prisma, query.patientId, doctorId);
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor, query.patientId ?? null);
    const rows = await this.prisma.appointment.findMany({ where: {
      doctorId, ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(cursor ? { OR: [{ startTime: { lt: new Date(cursor.t) } },
        { startTime: new Date(cursor.t), id: { lt: cursor.i } }] } : {}),
    }, select: appointmentSelection, orderBy: [{ startTime: 'desc' }, { id: 'desc' }], take: 21 });
    const items = rows.slice(0, 20).map(appointmentView);
    const last = items[items.length - 1];
    return { items, nextCursor: rows.length > 20 && last
      ? encodeCursor({ t: last.startTime, i: last.id, p: query.patientId ?? null }) : null };
  }
  async calendar(userId: string, query: AppointmentCalendarDto) {
    const doctorId = await this.requireDoctorId(userId);
    const { start, end } = calendarBounds(query.from, query.to);
    const rows = await this.prisma.appointment.findMany({ where: {
      doctorId, status: { not: 'CANCELLED' }, startTime: { lt: end }, endTime: { gt: start },
    }, select: appointmentSelection, orderBy: [{ startTime: 'asc' }, { id: 'asc' }], take: 301 });
    return { items: rows.slice(0, 300).map(appointmentView), truncated: rows.length > 300 };
  }
}
