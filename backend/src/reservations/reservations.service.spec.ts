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
