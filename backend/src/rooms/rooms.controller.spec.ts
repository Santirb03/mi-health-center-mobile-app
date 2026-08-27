import {
  Test,
  TestingModule,
} from '@nestjs/testing';

import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

describe('RoomsController', () => {
  let controller: RoomsController;

  const mockRoomsService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    getAvailability: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule =
      await Test.createTestingModule({
        controllers: [
          RoomsController,
        ],
        providers: [
          {
            provide:
              RoomsService,
            useValue:
              mockRoomsService,
          },
        ],
      }).compile();

    controller =
      module.get<RoomsController>(
        RoomsController,
      );
  });

  describe('findAll', () => {
    it('should return all active rooms', async () => {
      const expectedResult = [
        {
          id: 'room-1',
          name: 'Room A',
          pricePerHour: 350,
        },
        {
          id: 'room-2',
          name: 'Room B',
          pricePerHour: 400,
        },
      ];

      mockRoomsService
        .findAll
        .mockResolvedValue(
          expectedResult,
        );

      const result =
        await controller.findAll();

      expect(
        mockRoomsService.findAll,
      ).toHaveBeenCalled();

      expect(result).toEqual(
        expectedResult,
      );
    });
  });

  describe('findOne', () => {
    it('should return a room by id', async () => {
      const expectedResult = {
        id: 'room-123',
        name: 'Room A',
        pricePerHour: 350,
      };

      mockRoomsService
        .findOne
        .mockResolvedValue(
          expectedResult,
        );

      const result =
        await controller.findOne(
          'room-123',
        );

      expect(
        mockRoomsService.findOne,
      ).toHaveBeenCalledWith(
        'room-123',
      );

      expect(result).toEqual(
        expectedResult,
      );
    });
  });

  describe('getAvailability', () => {
    it('should return room availability for a date', async () => {
      const expectedResult = {
        roomId: 'room-123',
        roomName: 'Room A',
        date: '2026-09-01',
        timeZone:
          'America/Mexico_City',
        opensAt: '08:00',
        closesAt: '21:00',
        slots: [
          {
            startTime: '08:00',
            endTime: '09:00',
            available: true,
          },
        ],
      };

      mockRoomsService
        .getAvailability
        .mockResolvedValue(
          expectedResult,
        );

      const result =
        await controller.getAvailability(
          'room-123',
          '2026-09-01',
        );

      expect(
        mockRoomsService
          .getAvailability,
      ).toHaveBeenCalledWith(
        'room-123',
        '2026-09-01',
      );

      expect(result).toEqual(
        expectedResult,
      );
    });
  });

  describe('create', () => {
    it('should create a room with the DTO', async () => {
      const dto = {
        name: 'Room A',
        description:
          'Medical consultation room',
        pricePerHour: 350,
      };

      const expectedResult = {
        id: 'room-123',
        ...dto,
      };

      mockRoomsService
        .create
        .mockResolvedValue(
          expectedResult,
        );

      const result =
        await controller.create(
          dto,
        );

      expect(
        mockRoomsService.create,
      ).toHaveBeenCalledWith(
        dto,
      );

      expect(result).toEqual(
        expectedResult,
      );
    });
  });

  describe('update', () => {
    it('should update a room', async () => {
      const dto = {
        name: 'Updated Room',
        pricePerHour: 500,
      };

      const expectedResult = {
        id: 'room-123',
        name: 'Updated Room',
        description:
          'Medical consultation room',
        pricePerHour: 500,
        active: true,
      };

      mockRoomsService
        .update
        .mockResolvedValue(
          expectedResult,
        );

      const result =
        await controller.update(
          'room-123',
          dto,
        );

      expect(
        mockRoomsService.update,
      ).toHaveBeenCalledWith(
        'room-123',
        dto,
      );

      expect(result).toEqual(
        expectedResult,
      );
    });
  });

  describe('remove', () => {
    it('should deactivate a room', async () => {
      const expectedResult = {
        id: 'room-123',
        name: 'Room A',
        pricePerHour: 350,
        active: false,
      };

      mockRoomsService
        .remove
        .mockResolvedValue(
          expectedResult,
        );

      const result =
        await controller.remove(
          'room-123',
        );

      expect(
        mockRoomsService.remove,
      ).toHaveBeenCalledWith(
        'room-123',
      );

      expect(result).toEqual(
        expectedResult,
      );
    });
  });
});