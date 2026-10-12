import { AppointmentsService } from './appointments.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AppointmentsService', () => {
  const startTime = new Date('2090-01-01T15:00:00Z');
  const endTime = new Date('2090-01-01T16:00:00Z');
  const reservation = { id: 'reservation', doctorId: 'doctor', roomId: 'room', status: 'CONFIRMED', startTime, endTime };
  const row = { id: 'appointment', patientId: 'patient', doctorId: 'doctor', roomId: 'room', reservationId: 'reservation',
    status: 'SCHEDULED', startTime, endTime, createdAt: startTime, updatedAt: startTime,
    patient: { id: 'patient', firstName: 'Test', lastName: 'Patient' }, reservation: { ...reservation, room: { id: 'room', name: 'Room' } } };
  const tx = {
    $executeRaw: jest.fn(), $queryRaw: jest.fn(),
    doctorProfile: { findFirst: jest.fn() }, patient: { findFirst: jest.fn() },
    reservation: { findFirst: jest.fn() },
    appointment: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
  };
  const prisma = { ...tx, doctorProfile: { ...tx.doctorProfile, findUnique: jest.fn() }, $transaction: jest.fn() };
  const service = new AppointmentsService(prisma as unknown as PrismaService);
  const dto = { patientId: 'patient', reservationId: 'reservation', startTime: startTime.toISOString(), endTime: endTime.toISOString() };
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.doctorProfile.findUnique.mockResolvedValue({ id: 'doctor' });
    tx.doctorProfile.findFirst.mockResolvedValue({ id: 'doctor' });
    tx.$queryRaw.mockResolvedValue([{ roomId: 'room' }]);
    tx.reservation.findFirst.mockResolvedValue(reservation);
    tx.patient.findFirst.mockResolvedValue({ id: 'patient' });
    tx.appointment.create.mockResolvedValue(row);
    tx.appointment.updateMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation(work => work(tx));
  });
  it('locks doctor then room, rereads reservation and derives room with no notes', async () => {
    await service.create('user', dto);
    expect(tx.$executeRaw.mock.calls.map(call => call[0].join(''))).toEqual([
      'SELECT pg_advisory_xact_lock(7101, hashtext())', 'SELECT pg_advisory_xact_lock(hashtext())',
    ]);
    expect(tx.reservation.findFirst).toHaveBeenCalledTimes(2);
    expect(tx.reservation.findFirst).toHaveBeenLastCalledWith({ where: { id: 'reservation', doctorId: 'doctor' } });
    expect(tx.patient.findFirst).toHaveBeenCalledWith({ where: { id: 'patient', doctorId: 'doctor' }, select: { id: true } });
    expect(tx.appointment.create.mock.calls[0][0].data).toEqual({ doctorId: 'doctor', patientId: 'patient',
      reservationId: 'reservation', roomId: 'room', startTime, endTime, status: 'SCHEDULED' });
  });
  it('checks completed as well as scheduled conflicts and returns 409', async () => {
    tx.appointment.findFirst.mockResolvedValue({ id: 'conflict' });
    await expect(service.create('user', dto)).rejects.toMatchObject({ status: 409 });
    expect(tx.appointment.findFirst.mock.calls[0][0].where.status).toEqual({ not: 'CANCELLED' });
  });
  it('rejects missing profile and foreign resources without writing', async () => {
    prisma.doctorProfile.findUnique.mockResolvedValueOnce(null);
    await expect(service.create('user', dto)).rejects.toThrow('Doctor profile not found');
    tx.patient.findFirst.mockResolvedValueOnce(null);
    await expect(service.create('user', dto)).rejects.toThrow('Patient not found');
    tx.reservation.findFirst.mockResolvedValueOnce(null);
    await expect(service.create('user', dto)).rejects.toThrow('Reservation not found');
    tx.appointment.findFirst.mockResolvedValueOnce(null);
    await expect(service.findOne('user', 'foreign')).rejects.toThrow('Appointment not found');
    expect(tx.appointment.create).not.toHaveBeenCalled();
  });
  it('revalidates profile and reservation state after acquiring locks', async () => {
    tx.doctorProfile.findFirst.mockResolvedValueOnce(null);
    await expect(service.create('user', dto)).rejects.toThrow('Doctor profile not found');
    tx.reservation.findFirst.mockResolvedValueOnce(reservation).mockResolvedValueOnce({ ...reservation, status: 'CANCELLED' });
    await expect(service.create('user', dto)).rejects.toMatchObject({ status: 409 });
  });
  it.each(['cancel', 'complete'] as const)('%s is atomic with owner and expected state', async method => {
    const current = { ...row, startTime: new Date('2000-01-01T15:00:00Z') };
    tx.appointment.findFirst.mockResolvedValue(current);
    await service[method]('user', 'appointment');
    expect(tx.appointment.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'appointment', doctorId: 'doctor', status: 'SCHEDULED' });
  });
  it.each([['cancel', 'CANCELLED'], ['complete', 'COMPLETED']] as const)('%s is idempotent', async (method, status) => {
    tx.appointment.findFirst.mockResolvedValue({ ...row, status });
    await service[method]('user', 'appointment'); expect(tx.appointment.updateMany).not.toHaveBeenCalled();
  });
  it.each([['cancel', 'COMPLETED'], ['complete', 'CANCELLED']] as const)('%s rejects opposite terminal state', async (method, status) => {
    tx.appointment.findFirst.mockResolvedValue({ ...row, status });
    await expect(service[method]('user', 'appointment')).rejects.toMatchObject({ status: 409 });
  });
  it('completes only at or after start', async () => {
    tx.appointment.findFirst.mockResolvedValue(row);
    await expect(service.complete('user', 'appointment')).rejects.toMatchObject({ status: 409 });
  });
  it('allows completion exactly at start without waiting for end', async () => {
    jest.useFakeTimers().setSystemTime(startTime);
    try {
      tx.appointment.findFirst.mockResolvedValueOnce(row).mockResolvedValue({ ...row, status: 'COMPLETED' });
      expect((await service.complete('user', 'appointment')).status).toBe('COMPLETED');
      expect(tx.appointment.updateMany.mock.calls[0][0].where.startTime).toEqual({ lte: startTime });
    } finally { jest.useRealTimers(); }
  });
  it('reschedules with self excluded and state checked atomically', async () => {
    tx.appointment.findFirst.mockResolvedValueOnce(row).mockResolvedValueOnce(null).mockResolvedValue(row);
    await service.reschedule('user', 'appointment', dto);
    expect(tx.appointment.findFirst.mock.calls[1][0].where.id).toEqual({ not: 'appointment' });
    expect(tx.appointment.updateMany.mock.calls[0][0].where).toMatchObject({ doctorId: 'doctor', status: 'SCHEDULED' });
  });
  it.each([{ ...row, status: 'COMPLETED' }, { ...row, startTime: new Date('2000-01-01T15:00:00Z') }])('does not reschedule terminal or begun appointments', async current => {
    tx.appointment.findFirst.mockResolvedValueOnce(current);
    await expect(service.reschedule('user', 'appointment', dto)).rejects.toMatchObject({ status: 409 });
  });
  it('translates the observed adapter exclusion error without SQL leakage', async () => {
    tx.appointment.create.mockRejectedValue({ code: 'P2039', meta: { driverAdapterError: { cause: { originalCode: '23P01' } } } });
    await expect(service.create('user', dto)).rejects.toThrow('Appointment overlaps another appointment');
  });
  it('returns an empty final page with owner and correct bounded order', async () => {
    tx.appointment.findMany.mockResolvedValue([]);
    expect(await service.page('user', {})).toEqual({ items: [], nextCursor: null });
    expect(tx.appointment.findMany.mock.calls[0][0]).toMatchObject({ where: { doctorId: 'doctor' }, take: 21,
      orderBy: [{ startTime: 'desc' }, { id: 'desc' }] });
  });
});
