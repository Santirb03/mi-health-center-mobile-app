import { Test, TestingModule } from '@nestjs/testing';

import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

describe('ReservationsController', () => {
  let controller: ReservationsController;

  const mockReservationsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    cancel: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule =
      await Test.createTestingModule({
        controllers: [ReservationsController],
        providers: [
          {
            provide: ReservationsService,
            useValue: mockReservationsService,
          },
        ],
      }).compile();

    controller =
      module.get<ReservationsController>(
        ReservationsController,
      );
  });

  describe('create', () => {
    it('should create a reservation for the authenticated user', async () => {
      const req = {
        user: {
          userId: 'user-123',
          email: 'doctor@test.com',
          role: 'DOCTOR',
        },
      } as any;

      const dto = {
        roomId: 'room-123',
        startTime: '2026-09-01T10:00:00.000Z',
        endTime: '2026-09-01T12:00:00.000Z',
      };

      const expectedResult = {
        id: 'reservation-123',
        doctorId: 'doctor-123',
        roomId: 'room-123',
      };

      mockReservationsService.create.mockResolvedValue(
        expectedResult,
      );

      const result = await controller.create(
        req,
        dto,
      );

      expect(
        mockReservationsService.create,
      ).toHaveBeenCalledWith(
        'user-123',
        dto,
      );

      expect(result).toEqual(expectedResult);
    });
  });

  describe('findAll', () => {
    it('should return the authenticated user reservations', async () => {
      const req = {
        user: {
          userId: 'user-123',
          email: 'doctor@test.com',
          role: 'DOCTOR',
        },
      } as any;

      const expectedResult = [
        {
          id: 'reservation-1',
          roomId: 'room-1',
        },
        {
          id: 'reservation-2',
          roomId: 'room-2',
        },
      ];

      mockReservationsService.findAll.mockResolvedValue(
        expectedResult,
      );

      const result =
        await controller.findAll(req);

      expect(
        mockReservationsService.findAll,
      ).toHaveBeenCalledWith('user-123');

      expect(result).toEqual(expectedResult);
    });
  });

  describe('findOne', () => {
    it('should return a reservation belonging to the authenticated user', async () => {
      const req = {
        user: {
          userId: 'user-123',
          email: 'doctor@test.com',
          role: 'DOCTOR',
        },
      } as any;

      const expectedResult = {
        id: 'reservation-123',
        roomId: 'room-123',
      };

      mockReservationsService.findOne.mockResolvedValue(
        expectedResult,
      );

      const result =
        await controller.findOne(
          req,
          'reservation-123',
        );

      expect(
        mockReservationsService.findOne,
      ).toHaveBeenCalledWith(
        'user-123',
        'reservation-123',
      );

      expect(result).toEqual(expectedResult);
    });
  });

  describe('cancel', () => {
    it('should cancel a reservation belonging to the authenticated user', async () => {
      const req = {
        user: {
          userId: 'user-123',
          email: 'doctor@test.com',
          role: 'DOCTOR',
        },
      } as any;

      const expectedResult = {
        id: 'reservation-123',
        status: 'CANCELLED',
      };

      mockReservationsService.cancel.mockResolvedValue(
        expectedResult,
      );

      const result =
        await controller.cancel(
          req,
          'reservation-123',
        );

      expect(
        mockReservationsService.cancel,
      ).toHaveBeenCalledWith(
        'user-123',
        'reservation-123',
      );

      expect(result).toEqual(expectedResult);
    });
  });
});