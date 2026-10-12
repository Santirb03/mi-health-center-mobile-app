import { BadRequestException } from '@nestjs/common';
import { isISO8601, isUUID } from 'class-validator';
import { agendaDay } from '../reservations/admin-agenda.service';

export function explicitInstant(value: unknown): Date {
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !isISO8601(value, { strict: true, strictSeparator: true })) {
    throw new BadRequestException('Invalid appointment time; explicit timezone required');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new BadRequestException('Invalid appointment time');
  return date;
}
export function appointmentInterval(start: string, end: string, now: Date) {
  const startTime = explicitInstant(start);
  const endTime = explicitInstant(end);
  const duration = endTime.getTime() - startTime.getTime();
  if (startTime <= now) throw new BadRequestException('Appointment must start in the future');
  if (duration < 15 * 60000 || duration > 240 * 60000)
    throw new BadRequestException('Appointment duration must be between 15 and 240 minutes');
  if ([startTime, endTime].some(time => time.getUTCMinutes() % 5 || time.getUTCSeconds() || time.getUTCMilliseconds())
    || [start, end].some(time => /\.\d*[1-9]\d*(?:Z|[+-])/.test(time)))
    throw new BadRequestException('Appointment times must use five-minute precision');
  return { startTime, endTime };
}
export function requireContainment(start: Date, end: Date, reservation: { startTime: Date; endTime: Date }) {
  if (start < reservation.startTime || end > reservation.endTime)
    throw new BadRequestException('Appointment must be within reservation');
}
export function calendarBounds(from: string, to: string) {
  const start = agendaDay(from).start;
  const end = agendaDay(to).end;
  if (end <= start) throw new BadRequestException('Invalid calendar range');
  if (end.getTime() - start.getTime() > 14 * 86400000) throw new BadRequestException('Calendar range too large');
  return { start, end };
}
export type AppointmentCursor = { t: string; i: string; p: string | null };
export const encodeCursor = (cursor: AppointmentCursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');
export function decodeCursor(text: string, patientId: string | null): AppointmentCursor {
  try {
    if (text.length > 512 || !/^[A-Za-z0-9_-]+$/.test(text)) throw new Error();
    const bytes = Buffer.from(text, 'base64url');
    if (bytes.toString('base64url') !== text || !Buffer.from(bytes.toString('utf8')).equals(bytes)) throw new Error();
    const cursor = JSON.parse(bytes.toString('utf8')) as AppointmentCursor;
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)
      || Object.keys(cursor).sort().join(',') !== 'i,p,t'
      || typeof cursor.t !== 'string' || cursor.t.length > 30
      || explicitInstant(cursor.t).toISOString() !== cursor.t
      || typeof cursor.i !== 'string' || !isUUID(cursor.i)
      || (cursor.p !== null && (typeof cursor.p !== 'string' || !isUUID(cursor.p)))
      || cursor.p !== patientId) throw new Error();
    return cursor;
  } catch { throw new BadRequestException('Invalid appointment cursor'); }
}
