import {
  Test,
  TestingModule,
} from '@nestjs/testing';

import { NotFoundException } from '@nestjs/common';

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
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule =
      await Test.createTestingModule({
        providers: [
          RoomsService,
          {
            provide: PrismaService,
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

      mockPrismaService.room.findMany.mockResolvedValue(
        rooms,
      );

      const result =
        await service.findAll();

      expect(
        mockPrismaService.room.findMany,
      ).toHaveBeenCalledWith({
        where: {
          active: true,
        },
        orderBy: {
          name: 'asc',
        },
      });

      expect(result).toEqual(rooms);
    });
  });

  describe('findOne', () => {
    it('should return a room', async () => {
      const room = {
        id: 'room-123',
        name: 'Room A',
        pricePerHour: 350,
      };

      mockPrismaService.room.findUnique.mockResolvedValue(
        room,
      );

      const result =
        await service.findOne(
          'room-123',
        );

      expect(
        mockPrismaService.room.findUnique,
      ).toHaveBeenCalledWith({
        where: {
          id: 'room-123',
        },
      });

      expect(result).toEqual(room);
    });

    it('should throw if room does not exist', async () => {
      mockPrismaService.room.findUnique.mockResolvedValue(
        null,
      );

      await expect(
        service.findOne('room-123'),
      ).rejects.toThrow(
        new NotFoundException(
          'Room not found',
        ),
      );
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

      mockPrismaService.room.create.mockResolvedValue(
        room,
      );

      const result =
        await service.create(dto);

      expect(
        mockPrismaService.room.create,
      ).toHaveBeenCalledWith({
        data: {
          name: dto.name,
          description:
            dto.description,
          pricePerHour:
            dto.pricePerHour,
        },
      });

      expect(result).toEqual(room);
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

      mockPrismaService.room.findUnique.mockResolvedValue(
        existingRoom,
      );

      mockPrismaService.room.update.mockResolvedValue(
        updatedRoom,
      );

      const result =
        await service.update(
          'room-123',
          dto,
        );

      expect(
        mockPrismaService.room.update,
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
      mockPrismaService.room.findUnique.mockResolvedValue(
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
        mockPrismaService.room.update,
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

      mockPrismaService.room.findUnique.mockResolvedValue(
        existingRoom,
      );

      mockPrismaService.room.update.mockResolvedValue(
        deactivatedRoom,
      );

      const result =
        await service.remove(
          'room-123',
        );

      expect(
        mockPrismaService.room.update,
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
      mockPrismaService.room.findUnique.mockResolvedValue(
        null,
      );

      await expect(
        service.remove('room-123'),
      ).rejects.toThrow(
        new NotFoundException(
          'Room not found',
        ),
      );

      expect(
        mockPrismaService.room.update,
      ).not.toHaveBeenCalled();
    });
  });
});