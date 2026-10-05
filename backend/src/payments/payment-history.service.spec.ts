import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentHistoryService, decimalCents, formatCents } from './payment-history.service';
import { refundSummarySelection } from './refunds';

describe('PaymentHistoryService', () => {
  const time = new Date('2030-10-01T14:00:00.000Z');
  const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const row = (index: number) => ({
    id: id(index), reservationId: id(index + 100), amount: new Prisma.Decimal('450.00'),
    status: 'PAID', paidAt: time, createdAt: time, refunds: [{ amount: 3000, status: 'succeeded' }],
    refundSync: { automatic: false, lastCheckedAt: time, needsReview: false, lastError: null },
    reservation: { id: id(index + 100), startTime: time, endTime: new Date(time.getTime() + 3600000),
      status: 'CONFIRMED', room: { id: 'room', name: 'Consultorio' } },
  });
  const prisma = {
    doctorProfile: { findUnique: jest.fn() },
    payment: { findMany: jest.fn(), aggregate: jest.fn() },
    $queryRaw: jest.fn(), $transaction: jest.fn(),
  };
  let service: PaymentHistoryService;
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.doctorProfile.findUnique.mockResolvedValue({ id: 'doctor', userId: 'user' });
    prisma.payment.findMany.mockResolvedValue([]);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: null } });
    prisma.$queryRaw.mockResolvedValue([{ amount: null }]);
    prisma.$transaction.mockImplementation(callback => callback(prisma));
    service = new PaymentHistoryService(prisma as any);
  });

  it('rejects missing doctor profiles without reading financial data', async () => {
    prisma.doctorProfile.findUnique.mockResolvedValue(null);
    await expect(service.history('user', {})).rejects.toThrow(new NotFoundException('Doctor profile not found'));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    '', '@@@', 'e30=', 'a', Buffer.from('not JSON').toString('base64url'),
    encode({}), encode({ id: id(1) }), encode(null),
    encode({ id: 'invalid', time: time.toISOString() }),
    encode({ id: id(1), time: 'invalid' }),
    encode({ id: id(1), time: '2030-10-01T14:00:00Z' }),
    encode({ id: id(1), time: '2030-10-01T08:00:00.000-06:00' }),
    encode({ id: id(1), time: '2030-02-31T14:00:00.000Z' }),
    encode({ id: id(1), time: time.toISOString(), extra: true }),
  ])('rejects invalid payment cursor %s', async cursor => {
    await expect(service.history('user', { cursor })).rejects.toThrow(new BadRequestException('Invalid payment cursor'));
    expect(prisma.payment.findMany).not.toHaveBeenCalled();
  });

  it('scopes the page and gross aggregate to final payments of the authenticated doctor', async () => {
    await service.history('user', {});
    const eligible = { reservation: { doctorId: 'doctor' }, status: { in: ['PAID', 'REFUNDED'] } };
    expect(prisma.doctorProfile.findUnique).toHaveBeenCalledWith({ where: { userId: 'user' } });
    expect(prisma.payment.findMany).toHaveBeenCalledWith({
      where: { AND: [eligible] },
      select: { ...refundSummarySelection, id: true, reservationId: true, amount: true, paidAt: true, createdAt: true,
        reservation: { select: { id: true, startTime: true, endTime: true, status: true, room: { select: { id: true, name: true } } } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 21,
    });
    expect(prisma.payment.aggregate).toHaveBeenCalledWith({ where: eligible, _sum: { amount: true } });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' });
  });

  it.each([0, 1, 20, 21])('caps %i rows at twenty and emits the last returned row as nextCursor', async count => {
    const rows = Array.from({ length: count }, (_, index) => row(30 - index));
    prisma.payment.findMany.mockResolvedValue(rows);
    const result = await service.history('user', {});
    expect(result.items).toHaveLength(Math.min(count, 20));
    expect(result.nextCursor).toBe(count > 20 ? encode({ id: rows[19].id, time: time.toISOString() }) : null);
    if (count) {
      expect(result.items[0].amount).toBe('450.00');
      expect(result.items[0].paidAt).toBe(time.toISOString());
      expect(result.items[0].createdAt).toBe(time.toISOString());
      expect(result.items[0].refunds[0].amount).toBe(3000);
      expect(Object.keys(result.items[0]).sort()).toEqual([
        'id', 'reservationId', 'amount', 'status', 'paidAt', 'createdAt', 'refunds', 'refundSync', 'reservation',
      ].sort());
    }
  });

  it('keeps legacy null paidAt valid', async () => {
    prisma.payment.findMany.mockResolvedValue([{ ...row(1), paidAt: null }]);
    expect((await service.history('user', {})).items[0].paidAt).toBeNull();
  });

  it('continues tied timestamps strictly below the last id without duplicates or omissions', async () => {
    const rows = Array.from({ length: 22 }, (_, index) => row(22 - index));
    prisma.payment.findMany.mockResolvedValueOnce(rows.slice(0, 21)).mockResolvedValueOnce(rows.slice(20));
    const first = await service.history('user', {});
    const second = await service.history('user', { cursor: first.nextCursor! });
    expect(prisma.payment.findMany.mock.calls[1][0].where.AND[1]).toEqual({ OR: [
      { createdAt: { lt: time } }, { createdAt: time, id: { lt: id(3) } },
    ] });
    expect([...first.items, ...second.items].map(item => item.id)).toEqual(rows.map(item => item.id));
    expect(second.nextCursor).toBeNull();
    expect(second.totals).toBeNull();
    expect(prisma.payment.aggregate).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns zero global totals without payments', async () => {
    expect(await service.history('user', {})).toEqual({ items: [], nextCursor: null,
      totals: { paid: '0.00', refunded: '0.00', net: '0.00' } });
  });

  it('never aggregates totals on cursor pages', async () => {
    const result = await service.history('user', { cursor: encode({ id: id(1), time: time.toISOString() }) });
    expect(result.totals).toBeNull();
    expect(prisma.payment.aggregate).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('totals use global decimal sums and only succeeded refunds, independent of page items', async () => {
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal('250.00') } });
    prisma.$queryRaw.mockResolvedValue([{ amount: '3000' }]);
    const result = await service.history('user', {});
    expect(result.items).toEqual([]);
    expect(result.totals).toEqual({ paid: '250.00', refunded: '30.00', net: '220.00' });
    const [sql, doctorId] = prisma.$queryRaw.mock.calls[0];
    expect(sql.join('?')).toContain("AND r.status = 'succeeded'");
    expect(sql.join('?')).toContain('SUM(r.amount)::text');
    expect(doctorId).toBe('doctor');
  });

  it('keeps large aggregate sums and refunds exact beyond IEEE-754 precision', async () => {
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal('90071992547409.92') } });
    prisma.$queryRaw.mockResolvedValue([{ amount: '9007199254740993' }]);
    expect((await service.history('user', {})).totals).toEqual({
      paid: '90071992547409.92', refunded: '90071992547409.93', net: '-0.01',
    });
  });

  it('adds decimal amounts using integer cents and formats exactly two decimals', () => {
    expect(formatCents(decimalCents('0.10') + decimalCents('0.20'))).toBe('0.30');
    expect(formatCents(decimalCents('150.10') + decimalCents('99.90'))).toBe('250.00');
    expect(formatCents(decimalCents('90071992547409.91') + decimalCents('0.01'))).toBe('90071992547409.92');
    expect(formatCents(decimalCents('-0.01'))).toBe('-0.01');
    expect(() => decimalCents('1.001')).toThrow('Invalid decimal amount');
  });
});
