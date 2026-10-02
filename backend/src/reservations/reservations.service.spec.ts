import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';

import { ReservationsService } from './reservations.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ReservationsService', () => {
  let service: ReservationsService;

  const NOW = new Date('2026-08-28T18:00:00.000Z');

  const mockPrismaService = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
    doctorProfile: {
      findUnique: jest.fn(),
    },

    room: {
      findUnique: jest.fn(),
    },

    reservation: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },

    roomBlock: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrismaService.$queryRaw.mockResolvedValue([]);
    mockPrismaService.$executeRaw.mockResolvedValue(1);
    mockPrismaService.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrismaService) => unknown) =>
        callback(mockPrismaService),
    );

    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    const module: TestingModule =
      await Test.createTestingModule({
        providers: [
          ReservationsService,
          {
            provide: PrismaService,
            useValue: mockPrismaService,
          },
        ],
      }).compile();

    service =
      module.get<ReservationsService>(
        ReservationsService,
      );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('calendar', () => {
    const userId = 'calendar-user';
    const query = { from: '2030-10-01', to: '2030-10-01' };

    beforeEach(() => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue({ id: 'calendar-doctor', userId });
      mockPrismaService.reservation.findMany.mockResolvedValue([]);
    });

    it('rejects a missing doctor profile', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue(null);
      await expect(service.calendar(userId, query))
        .rejects.toThrow(new NotFoundException('Doctor profile not found'));
      expect(mockPrismaService.reservation.findMany).not.toHaveBeenCalled();
    });

    it('rejects reversed ranges', async () => {
      await expect(service.calendar(userId, { from: '2030-10-02', to: '2030-10-01' }))
        .rejects.toThrow(new BadRequestException('Invalid calendar range'));
      expect(mockPrismaService.reservation.findMany).not.toHaveBeenCalled();
    });

    it('rejects nonexistent dates using agendaDay', async () => {
      await expect(service.calendar(userId, { ...query, from: '2030-02-31' }))
        .rejects.toThrow(new BadRequestException('Invalid calendar date'));
      await expect(service.calendar(userId, { ...query, to: '2030-02-31' }))
        .rejects.toThrow(new BadRequestException('Invalid calendar date'));
      expect(mockPrismaService.reservation.findMany).not.toHaveBeenCalled();
    });

    it.each([
      ['2030-10-01', '2030-10-01', '2030-10-02T06:00:00Z'],
      ['2030-10-01', '2030-10-14', '2030-10-15T06:00:00Z'],
      ['2030-12-25', '2031-01-07', '2031-01-08T06:00:00Z'],
    ])('accepts the inclusive range %s through %s', async (from, to, end) => {
      expect(await service.calendar(userId, { from, to })).toEqual({ items: [], truncated: false });
      expect(mockPrismaService.reservation.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          startTime: { lt: new Date(end) },
          endTime: { gt: new Date(`${from}T06:00:00Z`) },
        }),
      }));
    });

    it('rejects fifteen inclusive business days', async () => {
      await expect(service.calendar(userId, { from: '2030-10-01', to: '2030-10-15' }))
        .rejects.toThrow(new BadRequestException('Calendar range too large'));
      expect(mockPrismaService.reservation.findMany).not.toHaveBeenCalled();
    });

    it('queries the authenticated doctor, strict overlap and live holds with UTC-6 boundaries', async () => {
      await service.calendar(userId, query);
      expect(mockPrismaService.doctorProfile.findUnique).toHaveBeenCalledWith({ where: { userId } });
      expect(mockPrismaService.reservation.findMany).toHaveBeenCalledWith({
        where: {
          doctorId: 'calendar-doctor',
          startTime: { lt: new Date('2030-10-02T06:00:00Z') },
          endTime: { gt: new Date('2030-10-01T06:00:00Z') },
          OR: [
            { status: 'CONFIRMED' },
            { status: 'COMPLETED' },
            { status: 'PENDING', expiresAt: { gt: NOW } },
          ],
        },
        include: { room: true },
        orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
        take: 301,
      });
      expect(mockPrismaService.reservation.update).not.toHaveBeenCalled();
    });

    it.each([0, 3, 300, 301])('returns at most 300 of %i rows with an explicit truncation flag', async (count) => {
      const rows = Array.from({ length: count }, (_, index) => ({ id: `calendar-${index}` }));
      mockPrismaService.reservation.findMany.mockResolvedValue(rows);
      expect(await service.calendar(userId, query)).toEqual({
        items: rows.slice(0, 300), truncated: count > 300,
      });
    });
  });

  describe('create', () => {
    const userId = 'user-123';

    const dto = {
      roomId: 'room-123',

      // 08:00 -> 10:00 Querétaro
      startTime: '2026-09-01T14:00:00.000Z',
      endTime: '2026-09-01T16:00:00.000Z',
    };

    const doctor = {
      id: 'doctor-123',
      userId,
    };

    const room = {
      id: 'room-123',
      active: true,
      pricePerHour: 500,
    };

    it('should throw if the doctor profile does not exist', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue(
        null,
      );

      await expect(
        service.create(userId, dto),
      ).rejects.toThrow(
        new NotFoundException(
          'Doctor profile not found',
        ),
      );

      expect(
        mockPrismaService.room.findUnique,
      ).not.toHaveBeenCalled();
    });

    it('should throw if the room does not exist', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue(
        doctor,
      );

      mockPrismaService.room.findUnique.mockResolvedValue(
        null,
      );

      await expect(
        service.create(userId, dto),
      ).rejects.toThrow(
        new NotFoundException(
          'Room not found or inactive',
        ),
      );

      expect(
        mockPrismaService.reservation.findFirst,
      ).not.toHaveBeenCalled();

      expect(
        mockPrismaService.roomBlock.findFirst,
      ).not.toHaveBeenCalled();
    });

    it('should throw if the room is inactive', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue(
        doctor,
      );

      mockPrismaService.room.findUnique.mockResolvedValue({
        ...room,
        active: false,
      });

      await expect(
        service.create(userId, dto),
      ).rejects.toThrow(
        new NotFoundException(
          'Room not found or inactive',
        ),
      );

      expect(
        mockPrismaService.roomBlock.findFirst,
      ).not.toHaveBeenCalled();
    });

    it('should throw if the date format is invalid', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue(
        doctor,
      );

      mockPrismaService.room.findUnique.mockResolvedValue(
        room,
      );

      const invalidDto = {
        ...dto,
        startTime: 'not-a-date',
      };

      await expect(
        service.create(userId, invalidDto),
      ).rejects.toThrow(
        new BadRequestException(
          'Invalid date format',
        ),
      );

      expect(
        mockPrismaService.reservation.findFirst,
      ).not.toHaveBeenCalled();

      expect(
        mockPrismaService.roomBlock.findFirst,
      ).not.toHaveBeenCalled();
    });

    it('should throw if end time is before start time', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue(
        doctor,
      );

      mockPrismaService.room.findUnique.mockResolvedValue(
        room,
      );

      const invalidDto = {
        ...dto,
        startTime: '2026-09-01T16:00:00.000Z',
        endTime: '2026-09-01T14:00:00.000Z',
      };

      await expect(
        service.create(userId, invalidDto),
      ).rejects.toThrow(
        new BadRequestException(
          'End time must be after start time',
        ),
      );
    });

    it('should throw if the reservation starts in the past', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue(
        doctor,
      );

      mockPrismaService.room.findUnique.mockResolvedValue(
        room,
      );

      const invalidDto = {
        ...dto,
        startTime: '2026-08-28T17:00:00.000Z',
        endTime: '2026-08-28T18:00:00.000Z',
      };

      await expect(
        service.create(userId, invalidDto),
      ).rejects.toThrow(
        new BadRequestException(
          'Reservations cannot be made in the past',
        ),
      );

      expect(
        mockPrismaService.reservation.findFirst,
      ).not.toHaveBeenCalled();

      expect(
        mockPrismaService.roomBlock.findFirst,
      ).not.toHaveBeenCalled();
    });

    it('should throw if reservation does not start and end on a full hour', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue(
        doctor,
      );

      mockPrismaService.room.findUnique.mockResolvedValue(
        room,
      );

      const invalidDto = {
        ...dto,
        startTime: '2026-09-01T14:30:00.000Z',
      };

      await expect(
        service.create(userId, invalidDto),
      ).rejects.toThrow(
        new BadRequestException(
          'Reservations must start and end on a full hour',
        ),
      );

      expect(
        mockPrismaService.reservation.findFirst,
      ).not.toHaveBeenCalled();

      expect(
        mockPrismaService.roomBlock.findFirst,
      ).not.toHaveBeenCalled();
    });

    it('should throw if reservation starts before 08:00', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue(
        doctor,
      );

      mockPrismaService.room.findUnique.mockResolvedValue(
        room,
      );

      const invalidDto = {
        ...dto,

        // 07:00 -> 08:00 Querétaro
        startTime: '2026-09-01T13:00:00.000Z',
        endTime: '2026-09-01T14:00:00.000Z',
      };

      await expect(
        service.create(userId, invalidDto),
      ).rejects.toThrow(
        new BadRequestException(
          'Reservations must be within business hours from 08:00 to 21:00',
        ),
      );

      expect(
        mockPrismaService.reservation.findFirst,
      ).not.toHaveBeenCalled();

      expect(
        mockPrismaService.roomBlock.findFirst,
      ).not.toHaveBeenCalled();
    });

    it('should throw if reservation ends after 21:00', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue(
        doctor,
      );

      mockPrismaService.room.findUnique.mockResolvedValue(
        room,
      );

      const invalidDto = {
        ...dto,

        // September 1:
        // 20:00 -> 22:00 Querétaro
        startTime: '2026-09-02T02:00:00.000Z',
        endTime: '2026-09-02T04:00:00.000Z',
      };

      await expect(
        service.create(userId, invalidDto),
      ).rejects.toThrow(
        new BadRequestException(
          'Reservations must be within business hours from 08:00 to 21:00',
        ),
      );

      expect(
        mockPrismaService.reservation.findFirst,
      ).not.toHaveBeenCalled();

      expect(
        mockPrismaService.roomBlock.findFirst,
      ).not.toHaveBeenCalled();
    });

    it('should throw if reservation starts at 21:00', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue(
        doctor,
      );

      mockPrismaService.room.findUnique.mockResolvedValue(
        room,
      );

      const invalidDto = {
        ...dto,

        // September 1:
        // 21:00 -> 22:00 Querétaro
        startTime: '2026-09-02T03:00:00.000Z',
        endTime: '2026-09-02T04:00:00.000Z',
      };

      await expect(
        service.create(userId, invalidDto),
      ).rejects.toThrow(
        new BadRequestException(
          'Reservations must be within business hours from 08:00 to 21:00',
        ),
      );

      expect(
        mockPrismaService.reservation.findFirst,
      ).not.toHaveBeenCalled();

      expect(
        mockPrismaService.roomBlock.findFirst,
      ).not.toHaveBeenCalled();
    });

    it('should throw if reservation crosses into another business day', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue(
        doctor,
      );

      mockPrismaService.room.findUnique.mockResolvedValue(
        room,
      );

      const invalidDto = {
        ...dto,

        // September 1, 20:00 Querétaro
        startTime: '2026-09-02T02:00:00.000Z',

        // September 2, 08:00 Querétaro
        endTime: '2026-09-02T14:00:00.000Z',
      };

      await expect(
        service.create(userId, invalidDto),
      ).rejects.toThrow(
        new BadRequestException(
          'Reservations must start and end on the same day',
        ),
      );

      expect(
        mockPrismaService.reservation.findFirst,
      ).not.toHaveBeenCalled();

      expect(
        mockPrismaService.roomBlock.findFirst,
      ).not.toHaveBeenCalled();
    });

    it('should allow a reservation from 20:00 to 21:00', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue(
        doctor,
      );

      mockPrismaService.room.findUnique.mockResolvedValue(
        room,
      );

      mockPrismaService.reservation.findFirst.mockResolvedValue(
        null,
      );

      mockPrismaService.roomBlock.findFirst.mockResolvedValue(
        null,
      );

      const validDto = {
        ...dto,

        // September 1, 20:00 -> 21:00 Querétaro
        startTime: '2026-09-02T02:00:00.000Z',
        endTime: '2026-09-02T03:00:00.000Z',
      };

      const createdReservation = {
        id: 'reservation-closing-hour',
        doctorId: doctor.id,
        roomId: room.id,
        startTime: new Date(validDto.startTime),
        endTime: new Date(validDto.endTime),
        totalPrice: 500,
        status: 'PENDING',
        expiresAt: new Date('2026-08-28T18:08:00.000Z'),
      };

      mockPrismaService.reservation.create.mockResolvedValue(
        createdReservation,
      );

      const result =
        await service.create(
          userId,
          validDto,
        );

      expect(
        mockPrismaService.roomBlock.findFirst,
      ).toHaveBeenCalledWith({
        where: {
          roomId: validDto.roomId,
          startTime: {
            lt: new Date(validDto.endTime),
          },
          endTime: {
            gt: new Date(validDto.startTime),
          },
        },
      });

      expect(
        mockPrismaService.reservation.create,
      ).toHaveBeenCalledWith({
        data: {
          doctorId: doctor.id,
          roomId: room.id,
          startTime:
            new Date(validDto.startTime),
          endTime:
            new Date(validDto.endTime),
          totalPrice: 500,
          status: 'PENDING',
          expiresAt: new Date('2026-08-28T18:08:00.000Z'),
        },
      });

      expect(result).toEqual(
        createdReservation,
      );
    });

    it('should throw if the room is already reserved', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue(
        doctor,
      );

      mockPrismaService.room.findUnique.mockResolvedValue(
        room,
      );

      mockPrismaService.reservation.findFirst.mockResolvedValue({
        id: 'existing-reservation',
        status: 'CONFIRMED',
      });

      await expect(
        service.create(userId, dto),
      ).rejects.toThrow(
        new BadRequestException(
          'Room is already reserved for the selected time',
        ),
      );

      expect(
        mockPrismaService.roomBlock.findFirst,
      ).not.toHaveBeenCalled();

      expect(
        mockPrismaService.reservation.create,
      ).not.toHaveBeenCalled();
    });

    it('should throw if the room is blocked for the selected time', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue(
        doctor,
      );

      mockPrismaService.room.findUnique.mockResolvedValue(
        room,
      );

      mockPrismaService.reservation.findFirst.mockResolvedValue(
        null,
      );

      mockPrismaService.roomBlock.findFirst.mockResolvedValue({
        id: 'block-123',
        roomId: room.id,
        startTime:
          new Date(
            '2026-09-01T14:00:00.000Z',
          ),
        endTime:
          new Date(
            '2026-09-01T16:00:00.000Z',
          ),
        reason: 'Maintenance',
      });

      await expect(
        service.create(userId, dto),
      ).rejects.toThrow(
        new BadRequestException(
          'Room is blocked for the selected time',
        ),
      );

      expect(
        mockPrismaService.roomBlock.findFirst,
      ).toHaveBeenCalledWith({
        where: {
          roomId: dto.roomId,
          startTime: {
            lt: new Date(dto.endTime),
          },
          endTime: {
            gt: new Date(dto.startTime),
          },
        },
      });

      expect(
        mockPrismaService.reservation.create,
      ).not.toHaveBeenCalled();
    });

    it('should create a reservation with the correct total price', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue(
        doctor,
      );

      mockPrismaService.room.findUnique.mockResolvedValue(
        room,
      );

      mockPrismaService.reservation.findFirst.mockResolvedValue(
        null,
      );

      mockPrismaService.roomBlock.findFirst.mockResolvedValue(
        null,
      );

      const createdReservation = {
        id: 'reservation-123',
        doctorId: 'doctor-123',
        roomId: 'room-123',
        startTime: new Date(dto.startTime),
        endTime: new Date(dto.endTime),
        totalPrice: 1000,
        status: 'PENDING',
        expiresAt: new Date('2026-08-28T18:08:00.000Z'),
      };

      mockPrismaService.reservation.create.mockResolvedValue(
        createdReservation,
      );

      const result =
        await service.create(
          userId,
          dto,
        );

      expect(
        mockPrismaService.roomBlock.findFirst,
      ).toHaveBeenCalledWith({
        where: {
          roomId: dto.roomId,
          startTime: {
            lt: new Date(dto.endTime),
          },
          endTime: {
            gt: new Date(dto.startTime),
          },
        },
      });

      expect(
        mockPrismaService.reservation.create,
      ).toHaveBeenCalledWith({
        data: {
          doctorId: 'doctor-123',
          roomId: 'room-123',
          startTime:
            new Date(dto.startTime),
          endTime:
            new Date(dto.endTime),
          totalPrice: 1000,
          status: 'PENDING',
          expiresAt: new Date('2026-08-28T18:08:00.000Z'),
        },
      });

      expect(result).toEqual(
        createdReservation,
      );
    });
  });

  describe('findAll', () => {
    it('should throw if the doctor profile does not exist', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue(
        null,
      );

      await expect(
        service.findAll('user-123'),
      ).rejects.toThrow(
        new NotFoundException(
          'Doctor profile not found',
        ),
      );
    });

    it('should return the doctor reservations', async () => {
      const doctor = {
        id: 'doctor-123',
        userId: 'user-123',
      };

      const reservations = [
        {
          id: 'reservation-1',
          doctorId: 'doctor-123',
          roomId: 'room-1',
        },
      ];

      mockPrismaService.doctorProfile.findUnique.mockResolvedValue(
        doctor,
      );

      mockPrismaService.reservation.findMany.mockResolvedValue(
        reservations,
      );

      const result =
        await service.findAll(
          'user-123',
        );

      expect(
        mockPrismaService.reservation.findMany,
      ).toHaveBeenCalledWith({
        where: {
          doctorId: 'doctor-123',
        },
        include: {
          room: true,
        },
        orderBy: {
          startTime: 'asc',
        },
      });

      expect(result).toEqual(
        reservations,
      );
    });
  });

  describe('findOne', () => {
    it('should throw if the doctor profile does not exist', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue(
        null,
      );

      await expect(
        service.findOne(
          'user-123',
          'reservation-123',
        ),
      ).rejects.toThrow(
        new NotFoundException(
          'Doctor profile not found',
        ),
      );
    });

    it('should throw if the reservation does not belong to the doctor', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue({
        id: 'doctor-123',
        userId: 'user-123',
      });

      mockPrismaService.reservation.findFirst.mockResolvedValue(
        null,
      );

      await expect(
        service.findOne(
          'user-123',
          'reservation-123',
        ),
      ).rejects.toThrow(
        new NotFoundException(
          'Reservation not found',
        ),
      );
    });

    it('should return the reservation', async () => {
      const reservation = {
        id: 'reservation-123',
        doctorId: 'doctor-123',
        roomId: 'room-123',
      };

      mockPrismaService.doctorProfile.findUnique.mockResolvedValue({
        id: 'doctor-123',
        userId: 'user-123',
      });

      mockPrismaService.reservation.findFirst.mockResolvedValue(
        reservation,
      );

      const result =
        await service.findOne(
          'user-123',
          'reservation-123',
        );

      expect(result).toEqual(
        reservation,
      );
    });
  });

  describe('cancel', () => {
    it.each([
      ['already started', -1000, 3600000],
      ['already ended', -7200000, -3600000],
      ['starting exactly now', 0, 3600000],
    ])('rejects CONFIRMED reservations %s', async (_label, startOffset, endOffset) => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue({ id: 'doctor-123' });
      mockPrismaService.reservation.findFirst.mockResolvedValue({
        id: 'reservation-123', roomId: 'room-123', status: 'CONFIRMED',
        startTime: new Date(Date.now() + Number(startOffset)),
        endTime: new Date(Date.now() + Number(endOffset)),
      });

      const result = service.cancel('user-123', 'reservation-123');
      await expect(result).rejects.toBeInstanceOf(BadRequestException);
      await expect(result).rejects.toHaveProperty(
        'message', 'Reservations that have already started cannot be cancelled',
      );
      expect(mockPrismaService.reservation.update).not.toHaveBeenCalled();
    });

    it('cancels a future CONFIRMED reservation', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue({ id: 'doctor-123' });
      mockPrismaService.reservation.findFirst.mockResolvedValue({
        id: 'reservation-123', roomId: 'room-123', status: 'CONFIRMED',
        startTime: new Date(Date.now() + 7200000),
        endTime: new Date(Date.now() + 10800000),
      });
      const cancelled = { id: 'reservation-123', status: 'CANCELLED' };
      mockPrismaService.reservation.update.mockResolvedValue(cancelled);

      await expect(service.cancel('user-123', 'reservation-123')).resolves.toEqual(cancelled);
      expect(mockPrismaService.reservation.update).toHaveBeenCalledWith({
        where: { id: 'reservation-123' }, data: { status: 'CANCELLED' },
      });
    });

    it('should reject cancellation when the reservation expires while waiting for the room lock', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue({ id: 'doctor-123' });
      mockPrismaService.reservation.findFirst
        .mockResolvedValueOnce({ id: 'reservation-123', roomId: 'room-123', status: 'PENDING' })
        .mockResolvedValueOnce({ id: 'reservation-123', roomId: 'room-123', status: 'EXPIRED' });

      await expect(service.cancel('user-123', 'reservation-123'))
        .rejects.toThrow('Reservation is already expired');
      expect(mockPrismaService.reservation.update).not.toHaveBeenCalled();
    });

    it('should throw if the doctor profile does not exist', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue(
        null,
      );

      await expect(
        service.cancel(
          'user-123',
          'reservation-123',
        ),
      ).rejects.toThrow(
        new NotFoundException(
          'Doctor profile not found',
        ),
      );
    });

    it('should throw if the reservation does not exist', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue({
        id: 'doctor-123',
        userId: 'user-123',
      });

      mockPrismaService.reservation.findFirst.mockResolvedValue(
        null,
      );

      await expect(
        service.cancel(
          'user-123',
          'reservation-123',
        ),
      ).rejects.toThrow(
        new NotFoundException(
          'Reservation not found',
        ),
      );
    });

    it('should throw if the reservation is already cancelled', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue({
        id: 'doctor-123',
        userId: 'user-123',
      });

      mockPrismaService.reservation.findFirst.mockResolvedValue({
        id: 'reservation-123',
        status: 'CANCELLED',
      });

      await expect(
        service.cancel(
          'user-123',
          'reservation-123',
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'Reservation is already cancelled',
        ),
      );

      expect(
        mockPrismaService.reservation.update,
      ).not.toHaveBeenCalled();
    });

    it('should throw if the reservation is completed', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue({
        id: 'doctor-123',
        userId: 'user-123',
      });

      mockPrismaService.reservation.findFirst.mockResolvedValue({
        id: 'reservation-123',
        status: 'COMPLETED',
      });

      await expect(
        service.cancel(
          'user-123',
          'reservation-123',
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'Completed reservations cannot be cancelled',
        ),
      );

      expect(
        mockPrismaService.reservation.update,
      ).not.toHaveBeenCalled();
    });

    it('should cancel a valid reservation', async () => {
      mockPrismaService.doctorProfile.findUnique.mockResolvedValue({
        id: 'doctor-123',
        userId: 'user-123',
      });

      mockPrismaService.reservation.findFirst.mockResolvedValue({
        id: 'reservation-123',
        status: 'PENDING',
      });

      const cancelledReservation = {
        id: 'reservation-123',
        status: 'CANCELLED',
      };

      mockPrismaService.reservation.update.mockResolvedValue(
        cancelledReservation,
      );

      const result =
        await service.cancel(
          'user-123',
          'reservation-123',
        );

      expect(
        mockPrismaService.reservation.update,
      ).toHaveBeenCalledWith({
        where: {
          id: 'reservation-123',
        },
        data: {
          status: 'CANCELLED',
        },
      });

      expect(result).toEqual(
        cancelledReservation,
      );
    });
  });
});
