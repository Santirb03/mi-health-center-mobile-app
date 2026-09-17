import { NotFoundException } from '@nestjs/common';
import { ReservationsService } from '../reservations/reservations.service';
import { RoomsService } from './rooms.service';

describe('Room changes during reservation creation', () => {
  const input = {
    roomId: 'room',
    startTime: '2099-01-10T14:00:00Z',
    endTime: '2099-01-10T16:00:00Z',
  };
  function setup(currentRoom: object | null) {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      room: {
        findUnique: jest.fn().mockResolvedValue(currentRoom),
        update: jest.fn().mockResolvedValue(currentRoom),
      },
      roomBlock: { findFirst: jest.fn().mockResolvedValue(null) },
      reservation: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => data),
      },
    };
    const prisma = {
      doctorProfile: {
        findUnique: jest.fn().mockResolvedValue({ id: 'doctor' }),
      },
      room: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'room', active: true, pricePerHour: 100 }),
      },
      $transaction: (fn: (value: typeof tx) => unknown) => fn(tx),
    };
    return {
      tx,
      reservations: new ReservationsService(prisma as any),
      rooms: new RoomsService(prisma as any),
    };
  }
  it('uses the current price after obtaining the lock', async () => {
    const f = setup({ id: 'room', active: true, pricePerHour: 275.5 });
    const result = await f.reservations.create('user', input);
    expect(result.totalPrice).toBe(551);
    expect(f.tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      f.tx.room.findUnique.mock.invocationCallOrder[0],
    );
  });
  it('rejects a room deactivated after the initial read', async () => {
    const f = setup({ id: 'room', active: false, pricePerHour: 100 });
    await expect(f.reservations.create('user', input)).rejects.toThrow(
      NotFoundException,
    );
    expect(f.tx.reservation.create).not.toHaveBeenCalled();
  });
  it('activation and price edits acquire the shared room lock without changing reservations', async () => {
    const f = setup({ id: 'room', active: false, pricePerHour: 100 });
    await f.rooms.update('room', { active: true, pricePerHour: 250 });
    expect(f.tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      f.tx.room.update.mock.invocationCallOrder[0],
    );
    expect(f.tx.room.update).toHaveBeenCalledWith({
      where: { id: 'room' },
      data: { active: true, pricePerHour: 250 },
    });
    expect(f.tx.reservation.create).not.toHaveBeenCalled();
  });
});
