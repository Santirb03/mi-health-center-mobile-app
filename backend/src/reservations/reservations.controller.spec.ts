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

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});