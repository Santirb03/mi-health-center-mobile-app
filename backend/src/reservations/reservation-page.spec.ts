import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

describe('Reservation pagination HTTP boundary', () => {
  let app: INestApplication;
  const jwt = new JwtService({ secret: 'pagination-test-secret' });
  const prisma = {
    doctorProfile: { findUnique: jest.fn() },
    reservation: { findMany: jest.fn() },
  };
  const token = () => jwt.sign({ sub: 'user-a', role: 'DOCTOR', type: 'access' });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ReservationsController],
      providers: [ReservationsService, JwtStrategy,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'pagination-test-secret' } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.doctorProfile.findUnique.mockResolvedValue({ id: 'doctor-a' });
    prisma.reservation.findMany.mockResolvedValue([]);
  });
  afterAll(async () => { await app.close(); });

  it('requires authentication and never accepts a doctor ID from the client', async () => {
    await request(app.getHttpServer()).get('/reservations/page?group=history').expect(401);
    await request(app.getHttpServer()).get('/reservations/page?group=history&doctorId=other')
      .auth(token(), { type: 'bearer' }).expect(400);
    expect(prisma.reservation.findMany).not.toHaveBeenCalled();
  });
  it.each(['', 'group=wrong', 'group=history&cursor=bad', `group=history&cursor=${'a'.repeat(513)}`])('rejects malformed query %s', async (query) => {
    await request(app.getHttpServer()).get(`/reservations/page?${query}`)
      .auth(token(), { type: 'bearer' }).expect(400);
    expect(prisma.reservation.findMany).not.toHaveBeenCalled();
  });
  it.each(['pending', 'confirmed', 'history'])('bounds and scopes the %s query', async (group) => {
    const response = await request(app.getHttpServer()).get(`/reservations/page?group=${group}`)
      .auth(token(), { type: 'bearer' }).expect(200);
    expect(response.body).toEqual({ items: [], nextCursor: null });
    expect(prisma.doctorProfile.findUnique).toHaveBeenCalledWith({ where: { userId: 'user-a' } });
    const query = prisma.reservation.findMany.mock.calls[0][0];
    expect(query.take).toBe(21);
    expect(query.where.AND[0]).toEqual({ doctorId: 'doctor-a' });
    expect(query.orderBy).toHaveLength(2);
  });
  it('rejects a cursor belonging to another section', async () => {
    const cursor = Buffer.from(JSON.stringify({ group: 'pending', id: '00000000-0000-4000-8000-000000000001', time: new Date().toISOString() })).toString('base64url');
    await request(app.getHttpServer()).get('/reservations/page').query({ group: 'history', cursor })
      .auth(token(), { type: 'bearer' }).expect(400);
  });
});
