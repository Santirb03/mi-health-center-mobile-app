import { Test, TestingModule } from '@nestjs/testing';
import { ReservationsService } from './reservations.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ReservationsService', () => {
  let service: ReservationsService;

  const mockPrismaService = {
    doctorProfile: {
      findUnique: jest.fn(),
    },
    room: {
      findUnique: jest.fn(),
    },
    reservation: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

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

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});