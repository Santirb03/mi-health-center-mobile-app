import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';

import {
  Test,
  TestingModule,
} from '@nestjs/testing';

import { RoomsService } from './rooms.service';
import { PrismaService } from '../prisma/prisma.service';

describe('RoomsService', () => {
  let service: RoomsService;

  const mockPrismaService = {
    room: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    reservation: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule =
      await Test.createTestingModule({
        providers: [
          RoomsService,
          {
            provide:
              PrismaService,
            useValue:
              mockPrismaService,
          },
        ],
      }).compile();

    service =
      module.get<RoomsService>(
        RoomsService,
      );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return active rooms ordered by name', async () => {
      const rooms = [
        {
          id: 'room-1',
          name: 'Room A',
          active: true,
        },
      ];

      mockPrismaService
        .room
        .findMany
        .mockResolvedValue(
          rooms,
        );

      const result =
        await service.findAll();

      expect(
        mockPrismaService
          .room
          .findMany,
      ).toHaveBeenCalledWith({
        where: {
          active: true,
        },
        orderBy: {
          name: 'asc',
        },
      });

      expect(result).toEqual(
        rooms,
      );
    });
  });

  describe('findOne', () => {
    it('should return a room', async () => {
      const room = {
        id: 'room-123',
        name: 'Room A',
        pricePerHour: 350,
      };

      mockPrismaService
        .room
        .findUnique
        .mockResolvedValue(
          room,
        );

      const result =
        await service.findOne(
          'room-123',
        );

      expect(
        mockPrismaService
          .room
          .findUnique,
      ).toHaveBeenCalledWith({
        where: {
          id: 'room-123',
        },
      });

      expect(result).toEqual(
        room,
      );
    });

    it('should throw if room does not exist', async () => {
      mockPrismaService
        .room
        .findUnique
        .mockResolvedValue(
          null,
        );

      await expect(
        service.findOne(
          'room-123',
        ),
      ).rejects.toThrow(
        new NotFoundException(
          'Room not found',
        ),
      );
    });
  });

  describe('getAvailability', () => {
    it('should return 13 hourly slots from 08:00 to 21:00', async () => {
      mockPrismaService
        .room
        .findUnique
        .mockResolvedValue({
          id: 'room-123',
          name: 'Room A',
          active: true,
        });

      mockPrismaService
        .reservation
        .findMany
        .mockResolvedValue([]);

      const result =
        await service.getAvailability(
          'room-123',
          '2026-09-01',
        );

      expect(
        result.slots,
      ).toHaveLength(13);

      expect(
        result.slots[0],
      ).toEqual(
        expect.objectContaining({
          startTime: '08:00',
          endTime: '09:00',
          available: true,
        }),
      );

      expect(
        result.slots[12],
      ).toEqual(
        expect.objectContaining({
          startTime: '20:00',
          endTime: '21:00',
          available: true,
        }),
      );

      expect(result).toEqual(
        expect.objectContaining({
          roomId: 'room-123',
          roomName: 'Room A',
          date: '2026-09-01',
          timeZone:
            'America/Mexico_City',
          opensAt: '08:00',
          closesAt: '21:00',
        }),
      );
    });

    it('should mark reserved hours as unavailable', async () => {
      mockPrismaService
        .room
        .findUnique
        .mockResolvedValue({
          id: 'room-123',
          name: 'Room A',
          active: true,
        });

      mockPrismaService
        .reservation
        .findMany
        .mockResolvedValue([
          {
            startTime:
              new Date(
                '2026-09-01T16:00:00.000Z',
              ),
            endTime:
              new Date(
                '2026-09-01T18:00:00.000Z',
              ),
          },
        ]);

      const result =
        await service.getAvailability(
          'room-123',
          '2026-09-01',
        );

      const tenAM =
        result.slots.find(
          (slot) =>
            slot.startTime ===
            '10:00',
        );

      const elevenAM =
        result.slots.find(
          (slot) =>
            slot.startTime ===
            '11:00',
        );

      const noon =
        result.slots.find(
          (slot) =>
            slot.startTime ===
            '12:00',
        );

      expect(
        tenAM?.available,
      ).toBe(false);

      expect(
        elevenAM?.available,
      ).toBe(false);

      expect(
        noon?.available,
      ).toBe(true);
    });

    it('should query only pending and confirmed reservations', async () => {
      mockPrismaService
        .room
        .findUnique
        .mockResolvedValue({
          id: 'room-123',
          name: 'Room A',
          active: true,
        });

      mockPrismaService
        .reservation
        .findMany
        .mockResolvedValue([]);

      await service.getAvailability(
        'room-123',
        '2026-09-01',
      );

      expect(
        mockPrismaService
          .reservation
          .findMany,
      ).toHaveBeenCalledWith({
        where: {
          roomId: 'room-123',
          status: {
            in: [
              'PENDING',
              'CONFIRMED',
            ],
          },
          startTime: {
            lt: new Date(
              '2026-09-02T03:00:00.000Z',
            ),
          },
          endTime: {
            gt: new Date(
              '2026-09-01T14:00:00.000Z',
            ),
          },
        },
        select: {
          startTime: true,
          endTime: true,
        },
      });
    });

    it('should reject an invalid date format', async () => {
      await expect(
        service.getAvailability(
          'room-123',
          '09-01-2026',
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'Date must use YYYY-MM-DD format',
        ),
      );

      expect(
        mockPrismaService
          .room
          .findUnique,
      ).not.toHaveBeenCalled();
    });

    it('should reject an impossible date', async () => {
      await expect(
        service.getAvailability(
          'room-123',
          '2026-02-31',
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'Invalid date',
        ),
      );
    });

    it('should throw if room does not exist', async () => {
      mockPrismaService
        .room
        .findUnique
        .mockResolvedValue(
          null,
        );

      await expect(
        service.getAvailability(
          'room-123',
          '2026-09-01',
        ),
      ).rejects.toThrow(
        new NotFoundException(
          'Room not found',
        ),
      );
    });

    it('should throw if room is inactive', async () => {
      mockPrismaService
        .room
        .findUnique
        .mockResolvedValue({
          id: 'room-123',
          name: 'Room A',
          active: false,
        });

      await expect(
        service.getAvailability(
          'room-123',
          '2026-09-01',
        ),
      ).rejects.toThrow(
        new NotFoundException(
          'Room not found or inactive',
        ),
      );

      expect(
        mockPrismaService
          .reservation
          .findMany,
      ).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should create a room', async () => {
      const dto = {
        name: 'Room A',
        description:
          'Medical consultation room',
        pricePerHour: 350,
      };

      const room = {
        id: 'room-123',
        ...dto,
        active: true,
      };

      mockPrismaService
        .room
        .create
        .mockResolvedValue(
          room,
        );

      const result =
        await service.create(
          dto,
        );

      expect(
        mockPrismaService
          .room
          .create,
      ).toHaveBeenCalledWith({
        data: {
          name: dto.name,
          description:
            dto.description,
          pricePerHour:
            dto.pricePerHour,
        },
      });

      expect(result).toEqual(
        room,
      );
    });
  });

  describe('update', () => {
    it('should update a room', async () => {
      const dto = {
        name: 'Updated Room',
        pricePerHour: 500,
      };

      const existingRoom = {
        id: 'room-123',
        name: 'Room A',
        pricePerHour: 350,
        active: true,
      };

      const updatedRoom = {
        ...existingRoom,
        ...dto,
      };

      mockPrismaService
        .room
        .findUnique
        .mockResolvedValue(
          existingRoom,
        );

      mockPrismaService
        .room
        .update
        .mockResolvedValue(
          updatedRoom,
        );

      const result =
        await service.update(
          'room-123',
          dto,
        );

      expect(
        mockPrismaService
          .room
          .update,
      ).toHaveBeenCalledWith({
        where: {
          id: 'room-123',
        },
        data: {
          ...dto,
        },
      });

      expect(result).toEqual(
        updatedRoom,
      );
    });

    it('should throw if room does not exist', async () => {
      mockPrismaService
        .room
        .findUnique
        .mockResolvedValue(
          null,
        );

      await expect(
        service.update(
          'room-123',
          {
            name: 'Updated Room',
          },
        ),
      ).rejects.toThrow(
        new NotFoundException(
          'Room not found',
        ),
      );

      expect(
        mockPrismaService
          .room
          .update,
      ).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should deactivate a room instead of deleting it', async () => {
      const existingRoom = {
        id: 'room-123',
        name: 'Room A',
        pricePerHour: 350,
        active: true,
      };

      const deactivatedRoom = {
        ...existingRoom,
        active: false,
      };

      mockPrismaService
        .room
        .findUnique
        .mockResolvedValue(
          existingRoom,
        );

      mockPrismaService
        .room
        .update
        .mockResolvedValue(
          deactivatedRoom,
        );

      const result =
        await service.remove(
          'room-123',
        );

      expect(
        mockPrismaService
          .room
          .update,
      ).toHaveBeenCalledWith({
        where: {
          id: 'room-123',
        },
        data: {
          active: false,
        },
      });

      expect(result).toEqual(
        deactivatedRoom,
      );
    });

    it('should throw if room does not exist', async () => {
      mockPrismaService
        .room
        .findUnique
        .mockResolvedValue(
          null,
        );

      await expect(
        service.remove(
          'room-123',
        ),
      ).rejects.toThrow(
        new NotFoundException(
          'Room not found',
        ),
      );

      expect(
        mockPrismaService
          .room
          .update,
      ).not.toHaveBeenCalled();
    });
  });
});