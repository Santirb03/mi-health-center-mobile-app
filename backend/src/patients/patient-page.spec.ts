import { PatientsService } from './patients.service';
import { PrismaService } from '../prisma/prisma.service';
import { decodePatientCursor, encodePatientCursor } from './patient-search';

describe('PatientsService paginated contracts', () => {
  const prisma = {
    doctorProfile: { findUnique: jest.fn() },
    patient: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const service = new PatientsService(prisma as unknown as PrismaService);
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.doctorProfile.findUnique.mockResolvedValue({ id: 'doctor' });
    prisma.patient.findMany.mockResolvedValue([]);
  });
  it('requests 21 ordered rows with explicit projection and owner', async () => {
    expect(await service.findPage('user', {})).toEqual({ items: [], nextCursor: null });
    expect(prisma.doctorProfile.findUnique).toHaveBeenCalledWith({ where: { userId: 'user' } });
    expect(prisma.patient.findMany).toHaveBeenCalledWith({
      where: { doctorId: 'doctor' }, take: 21,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
      select: { id: true, firstName: true, lastName: true, phone: true, email: true,
        dateOfBirth: true, createdAt: true, updatedAt: true },
    });
  });
  it('returns 20 rows and a cursor based on the last returned row and normalized search', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      id: `12345678-1234-4234-8234-${String(index).padStart(12, '0')}`,
      firstName: 'John', lastName: 'Doe',
    }));
    prisma.patient.findMany.mockResolvedValue(rows);
    const page = await service.findPage('user', { q: '  JOHN   Doe ' });
    expect(page.items).toEqual(rows.slice(0, 20));
    expect(decodePatientCursor(page.nextCursor!, 'john doe'))
      .toEqual({ l: 'Doe', f: 'John', i: rows[19].id, q: 'john doe' });
  });
  it('ends pagination at exactly 20 rows', async () => {
    prisma.patient.findMany.mockResolvedValue(Array.from({ length: 20 }, () => ({ id: 'x' })));
    expect((await service.findPage('user', {})).nextCursor).toBeNull();
  });
  it('keeps ownership even when another user generated the cursor', async () => {
    const cursor = encodePatientCursor({ l: 'Doe', f: 'John', i: '12345678-1234-4234-8234-123456789abc' });
    await service.findPage('other-user', { cursor });
    expect(prisma.patient.findMany.mock.calls[0][0].where.doctorId).toBe('doctor');
    expect(prisma.patient.findMany.mock.calls[0][0].where.AND).toHaveLength(1);
  });
  it('preserves the missing-profile error and never queries patients', async () => {
    prisma.doctorProfile.findUnique.mockResolvedValue(null);
    for (const operation of [
      () => service.findPage('user', {}), () => service.findAll('user'),
      () => service.findOne('user', 'id'), () => service.update('user', 'id', { phone: null }),
      () => service.create('user', { firstName: 'John', lastName: 'Doe' }),
    ]) await expect(operation()).rejects.toThrow('Doctor profile not found');
    expect(prisma.patient.findMany).not.toHaveBeenCalled();
    expect(prisma.patient.findFirst).not.toHaveBeenCalled();
    expect(prisma.patient.create).not.toHaveBeenCalled();
  });
  it('rejects invalid cursor/search before database reads', async () => {
    await expect(service.findPage('user', { cursor: '??' })).rejects.toThrow('Invalid patient cursor');
    await expect(service.findPage('user', { q: 'x' })).rejects.toThrow('Invalid patient search');
    expect(prisma.patient.findMany).not.toHaveBeenCalled();
  });
  it('clears contact and birth date without changing response fields', async () => {
    prisma.patient.findFirst.mockResolvedValue({ id: 'patient', doctorId: 'doctor' });
    const response = { id: 'patient', doctorId: 'doctor', phone: null, email: null, dateOfBirth: null };
    prisma.patient.update.mockResolvedValue(response);
    expect(await service.update('user', 'patient', { phone: null, email: null, dateOfBirth: null })).toBe(response);
    expect(prisma.patient.findFirst).toHaveBeenCalledWith({ where: { id: 'patient', doctorId: 'doctor' } });
    expect(prisma.patient.update.mock.calls[0][0].data).toEqual({ phone: null, email: null, dateOfBirth: null });
  });
  it('rejects empty patch and foreign patients without writing', async () => {
    prisma.patient.findFirst.mockResolvedValue({ id: 'patient' });
    await expect(service.update('user', 'patient', {})).rejects.toThrow('At least one field');
    prisma.patient.findFirst.mockResolvedValue(null);
    await expect(service.update('user', 'foreign', { phone: null })).rejects.toThrow('Patient not found');
    await expect(service.findOne('user', 'foreign')).rejects.toThrow('Patient not found');
    expect(prisma.patient.update).not.toHaveBeenCalled();
  });
});
