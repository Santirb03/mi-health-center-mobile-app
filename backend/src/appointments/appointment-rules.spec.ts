import { appointmentInterval, explicitInstant, requireContainment, calendarBounds, encodeCursor, decodeCursor } from './appointment-rules';
import { appointmentView, AppointmentRow } from './appointment-view';
import { isExclusionViolation } from './exclusion-error';
import { ValidationPipe } from '@nestjs/common';
import { CreateAppointmentDto, RescheduleAppointmentDto } from './dto/appointment.dto';

const now = new Date('2026-10-11T12:00:00Z');
describe('appointment rules', () => {
  it.each(['2026-10-12T15:00:00Z', '2026-10-12T09:00:00-06:00'])('accepts explicit instant %s', value => {
    expect(explicitInstant(value).toISOString()).toBe('2026-10-12T15:00:00.000Z');
  });
  it.each(['2026-10-12T15:00:00', '2025-02-30T15:00:00Z', '2026-13-01T15:00:00Z',
    '2026-10-12T15:00:00+99:00', 'invalid'])('rejects invalid instant %s', value => {
    expect(() => explicitInstant(value)).toThrow();
  });
  it.each([15, 240])('allows %i minute duration', minutes => {
    const start = new Date('2026-10-12T15:00:00Z');
    expect(appointmentInterval(start.toISOString(), new Date(start.getTime() + minutes * 60000).toISOString(), now)).toBeDefined();
  });
  it.each([0, -15, 14, 241])('rejects %i minute duration', minutes => {
    const start = new Date('2026-10-12T15:00:00Z');
    expect(() => appointmentInterval(start.toISOString(), new Date(start.getTime() + minutes * 60000).toISOString(), now)).toThrow();
  });
  it.each(['2026-10-12T15:01:00Z', '2026-10-12T15:00:01Z', '2026-10-12T15:00:00.001Z',
    '2026-10-12T15:00:00.0001Z'])('rejects non-five-minute precision %s', start => {
    expect(() => appointmentInterval(start, '2026-10-12T16:00:00Z', now)).toThrow();
  });
  it('rejects past start and accepts non-whole hours', () => {
    expect(() => appointmentInterval('2026-10-11T12:00:00Z', '2026-10-11T12:15:00Z', now)).toThrow();
    expect(appointmentInterval('2026-10-12T15:05:00Z', '2026-10-12T15:20:00Z', now)).toBeDefined();
  });
  const reservation = { startTime: new Date('2026-10-12T15:00:00Z'), endTime: new Date('2026-10-12T16:00:00Z') };
  it.each([['15:00', '15:15'], ['15:45', '16:00'], ['15:15', '15:45']])('contains %s–%s', (start, end) => {
    expect(() => requireContainment(new Date(`2026-10-12T${start}:00Z`), new Date(`2026-10-12T${end}:00Z`), reservation)).not.toThrow();
  });
  it.each([['14:59', '15:15'], ['15:45', '16:01']])('rejects outside %s–%s', (start, end) => {
    expect(() => requireContainment(new Date(`2026-10-12T${start}:00Z`), new Date(`2026-10-12T${end}:00Z`), reservation)).toThrow();
  });
  it('calendar uses inclusive UTC-06 civil days, at most 14', () => {
    expect(calendarBounds('2026-10-31', '2026-11-01')).toEqual({ start: new Date('2026-10-31T06:00:00Z'), end: new Date('2026-11-02T06:00:00Z') });
    expect(() => calendarBounds('2026-10-12', '2026-10-11')).toThrow('Invalid calendar range');
    expect(() => calendarBounds('2026-10-01', '2026-10-15')).toThrow('Calendar range too large');
    expect(() => calendarBounds('2026-02-30', '2026-03-01')).toThrow();
  });
  const position = { t: '2026-10-12T15:00:00.000Z', i: '12345678-1234-4234-8234-123456789abc', p: null };
  it('cursor round trips and binds patient filter', () => {
    expect(decodeCursor(encodeCursor(position), null)).toEqual(position);
    expect(() => decodeCursor(encodeCursor(position), position.i)).toThrow('Invalid appointment cursor');
  });
  it.each(['?', 'YQ==', 'a', Buffer.from('null').toString('base64url'), Buffer.from('[]').toString('base64url'), 'a'.repeat(513)])('rejects invalid cursor %s', cursor => {
    expect(() => decodeCursor(cursor, null)).toThrow('Invalid appointment cursor');
  });
  it.each([{ ...position, i: 'invalid' }, { ...position, extra: true }, { ...position, p: 'invalid' },
    { ...position, t: '2026-10-12' }, { ...position, t: '2025-02-30T00:00:00.000Z' }])('rejects malformed position %p', cursor => {
    expect(() => decodeCursor(encodeCursor(cursor), null)).toThrow('Invalid appointment cursor');
  });
  it.each(['CONFIRMED', 'CANCELLED', null])('derives room review from reservation %s', status => {
    const base = { id: position.i, status: 'SCHEDULED', startTime: now, endTime: now, createdAt: now, updatedAt: now,
      patient: { id: position.i, firstName: 'Test', lastName: 'Patient' },
      reservation: status ? { id: position.i, status, startTime: now, endTime: now, room: { id: position.i, name: 'Room' } } : null } as AppointmentRow;
    expect(appointmentView(base).needsRoomReview).toBe(status !== 'CONFIRMED');
    for (const terminal of ['COMPLETED', 'CANCELLED'] as const)
      expect(appointmentView({ ...base, status: terminal }).needsRoomReview).toBe(false);
    expect(Object.keys(appointmentView(base))).not.toEqual(expect.arrayContaining(['notes', 'doctorId']));
  });
  it('recognizes the observed PrismaPg P2039/23P01 without treating other constraints as EXCLUDE', () => {
    expect(isExclusionViolation({ code: 'P2039', meta: { modelName: 'Appointment', driverAdapterError: {
      name: 'DriverAdapterError', cause: { originalCode: '23P01', kind: 'postgres', code: '23P01' },
    } } })).toBe(true);
    expect(isExclusionViolation({ code: '23P01' })).toBe(true);
    expect(isExclusionViolation({ code: 'P2039', meta: { driverAdapterError: { cause: { code: '23503' } } } })).toBe(false);
    expect(isExclusionViolation(null)).toBe(false);
  });
  it('the real validation pipe rejects missing paired times and unknown body fields', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    for (const body of [{ startTime: '2026-10-12T15:00:00Z' }, {}, { startTime: 'x', endTime: 'x', reservationId: null }])
      await expect(pipe.transform(body, { type: 'body', metatype: RescheduleAppointmentDto })).rejects.toMatchObject({ status: 400 });
    for (const field of ['notes', 'doctorId', 'roomId'])
      await expect(pipe.transform({ patientId: position.i, reservationId: position.i, startTime: 'x', endTime: 'x', [field]: 'x' },
        { type: 'body', metatype: CreateAppointmentDto })).rejects.toMatchObject({ status: 400 });
  });
});
