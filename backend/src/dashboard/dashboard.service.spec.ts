import { Prisma } from '@prisma/client';
import { DashboardService } from './dashboard.service';

describe('dashboard snapshot and aggregate contracts', () => {
  const query = { from: '2026-10-01', to: '2026-10-02' };
  const now = new Date('2026-10-01T18:00:00.000Z');
  afterEach(() => jest.useRealTimers());
  function fixture(size: number, financial = { paid: '0.30', refunded: '0' }) {
    const rooms = Array.from({ length: size }, (_, index) => ({
      id: `room-${index}`, name: `Room ${index}`, active: true, createdAt: new Date('2026-09-30T06:00:00Z'),
    }));
    const tx = {
      $queryRaw: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ roomId: 'room-0', ...financial }]),
      room: { findMany: jest.fn().mockResolvedValue(rooms) },
      roomBlock: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma = { $transaction: jest.fn(async callback => callback(tx)) };
    return { tx, prisma, service: new DashboardService(prisma as never) };
  }
  it('uses one reference instant and one repeatable-read snapshot with four data queries for 100 rooms', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const f = fixture(100);
    const result = await f.service.get(query);
    expect(result.generatedAt).toBe(now.toISOString());
    expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    expect(f.tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(f.tx.room.findMany).toHaveBeenCalledTimes(1); expect(f.tx.roomBlock.findMany).toHaveBeenCalledTimes(1);
    const classification = f.tx.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    const instants = classification.values.filter(value => value instanceof Date && value.getTime() === now.getTime());
    expect(instants).toHaveLength(2); expect(instants[0]).toBe(instants[1]);
    expect(result.rooms).toHaveLength(100);
    expect(result.rooms.every(room => room.availableMinutes === 1560)).toBe(true);
  });
  it('pending refunds do not reduce net: only succeeded are selected in the PostgreSQL aggregate', async () => {
    const f = fixture(1);
    const result = await f.service.get(query);
    const aggregate = f.tx.$queryRaw.mock.calls[1][0] as Prisma.Sql;
    expect(aggregate.sql).toContain("WHERE f.status = 'succeeded'");
    expect(aggregate.sql).toContain('p."paidAt" >=');
    expect(aggregate.sql).toContain('p."paidAt" <');
    expect(aggregate.sql).not.toContain('p."createdAt"');
    expect(result.revenue).toEqual({ paid: '0.30', refunded: '0.00', net: '0.30' });
  });
  it('preserves large PostgreSQL sums as exact cents and subtracts confirmed refunds', async () => {
    const f = fixture(1, { paid: '900719925474100.01', refunded: '3000' });
    const result = await f.service.get(query);
    expect(result.revenue).toEqual({ paid: '900719925474100.01', refunded: '30.00', net: '900719925474070.01' });
    expect(result.rooms[0].net).toBe('900719925474070.01');
  });
});
