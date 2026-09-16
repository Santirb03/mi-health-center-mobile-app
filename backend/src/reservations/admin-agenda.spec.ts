import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { AdminAgendaController } from './admin-agenda.controller';
import { AdminAgendaService, agendaDay } from './admin-agenda.service';
import { AdminAccessGuard } from './admin-access.guard';
import { RoomsController } from '../rooms/rooms.controller';
import { RoomsService } from '../rooms/rooms.service';

describe('Administrative agenda HTTP boundary', () => {
  let app: INestApplication;
  const roomsService = { findBlocks: jest.fn(), createBlock: jest.fn(), removeBlock: jest.fn() };
  const jwt = new JwtService({ secret: 'agenda-test-only-secret' });
  const prisma = {
    user: { findUnique: jest.fn() },
    room: { findMany: jest.fn() },
    reservation: { findMany: jest.fn() },
  };
  function token(role = 'ADMIN', type = 'access') {
    return jwt.sign({ sub: 'user-test', role, type }, { expiresIn: '5m' });
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminAgendaController, AuthController, RoomsController],
      providers: [
        AdminAgendaService,
        AdminAccessGuard,
        JwtStrategy,
        AuthService,
        { provide: RoomsService, useValue: roomsService },
        { provide: JwtService, useValue: jwt },
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { get: () => 'agenda-test-only-secret' },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-test',
      role: 'ADMIN',
    });
    prisma.reservation.findMany.mockResolvedValue([]);
    prisma.room.findMany.mockResolvedValue([]);
  });
  afterAll(async () => {
    await app.close();
  });

  it.each(['get', 'post', 'delete'] as const)('protects block %s with the current role, not stale token claims', async method => {
    const path = method === 'delete' ? '/rooms/room/blocks/block' : '/rooms/room/blocks';
    const body = { startTime: '2031-01-10T14:00:00Z', endTime: '2031-01-10T15:00:00Z', reason: 'Maintenance' };
    await request(app.getHttpServer())[method](path).send(body).expect(401);
    prisma.user.findUnique.mockResolvedValue({ role: 'DOCTOR' });
    await request(app.getHttpServer())[method](path).auth(token(), { type: 'bearer' }).send(body).expect(403);
    for (const call of Object.values(roomsService)) expect(call).not.toHaveBeenCalled();
    prisma.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
    await request(app.getHttpServer())[method](path).auth(token(), { type: 'bearer' }).send(body).expect(method === 'post' ? 201 : 200);
    const call = method === 'get' ? roomsService.findBlocks : method === 'post' ? roomsService.createBlock : roomsService.removeBlock;
    expect(call).toHaveBeenCalledTimes(1);
  });

  it.each(['/admin/agenda?date=2031-01-10', '/admin/rooms', '/auth/me'])(
    'rejects unauthenticated %s',
    async (path) => {
      await request(app.getHttpServer()).get(path).expect(401);
      expect(prisma.reservation.findMany).not.toHaveBeenCalled();
    },
  );
  it.each(['/admin/agenda?date=2031-01-10', '/admin/rooms'])(
    'rejects a doctor at %s',
    async (path) => {
      prisma.user.findUnique.mockResolvedValue({ role: 'DOCTOR' });
      await request(app.getHttpServer())
        .get(path)
        .auth(token('DOCTOR'), { type: 'bearer' })
        .expect(403);
      expect(prisma.reservation.findMany).not.toHaveBeenCalled();
      expect(prisma.room.findMany).not.toHaveBeenCalled();
    },
  );
  it('rejects revoked admin privileges even with an old admin JWT', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'DOCTOR' });
    await request(app.getHttpServer())
      .get('/admin/agenda?date=2031-01-10')
      .auth(token(), { type: 'bearer' })
      .expect(403);
  });
  it('rejects refresh tokens', async () => {
    await request(app.getHttpServer())
      .get('/admin/rooms')
      .auth(token('ADMIN', 'refresh'), { type: 'bearer' })
      .expect(401);
  });
  it('returns a current minimal profile without requiring a doctor profile', async () => {
    const r = await request(app.getHttpServer())
      .get('/auth/me')
      .auth(token(), { type: 'bearer' })
      .expect(200);
    expect(r.body).toEqual({ id: 'user-test', role: 'ADMIN' });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-test' },
      select: { id: true, role: true },
    });
  });
  it.each([
    '',
    '?date=2031-02-29',
    '?date=2031-13-01',
    '?date=invalid',
    '?date=2031-01-10&status=PAID',
    '?date=2031-01-10&roomId=bad',
    '?date=2031-01-10&page=0',
    '?date=2031-01-10&page=1.5',
    '?date=2031-01-10&page=10001',
    '?date=2031-01-10&doctorId=other',
  ])('rejects malformed query %s', async (query) => {
    await request(app.getHttpServer())
      .get(`/admin/agenda${query}`)
      .auth(token(), { type: 'bearer' })
      .expect(400);
    expect(prisma.reservation.findMany).not.toHaveBeenCalled();
  });
  it('applies Mexico City day boundaries, room and state together with stable pagination', async () => {
    const roomId = '9519d21d-8570-4fde-8ae7-03c87705fa91';
    await request(app.getHttpServer())
      .get(
        `/admin/agenda?date=2031-01-10&roomId=${roomId}&status=CONFIRMED&page=2`,
      )
      .auth(token(), { type: 'bearer' })
      .expect(200);
    const query = prisma.reservation.findMany.mock.calls[0][0];
    expect(query.where).toEqual({
      roomId,
      status: 'CONFIRMED',
      startTime: { lt: new Date('2031-01-11T06:00:00Z') },
      endTime: { gt: new Date('2031-01-10T06:00:00Z') },
    });
    expect(query.skip).toBe(50);
    expect(query.take).toBe(51);
    expect(query.orderBy).toEqual([{ startTime: 'asc' }, { id: 'asc' }]);
    expect(query.select.doctor).toEqual({
      select: { firstName: true, lastName: true },
    });
    expect(query.select.payment).toEqual({ select: { status: true } });
  });
  it('projects expired holds without changing persisted status and signals another page', async () => {
    prisma.reservation.findMany.mockResolvedValue(
      Array.from({ length: 51 }, (_, i) => ({
        id: String(i),
        status: 'PENDING',
        expiresAt: new Date('2000-01-01'),
      })),
    );
    const r = await request(app.getHttpServer())
      .get('/admin/agenda?date=2031-01-10')
      .auth(token(), { type: 'bearer' })
      .expect(200);
    expect(r.body.items).toHaveLength(50);
    expect(r.body.hasMore).toBe(true);
    expect(r.body.items[0]).toMatchObject({
      status: 'PENDING',
      displayStatus: 'EXPIRED',
    });
  });
  it('pending filter excludes elapsed and null holds', async () => {
    await request(app.getHttpServer())
      .get('/admin/agenda?date=2031-01-10&status=PENDING')
      .auth(token(), { type: 'bearer' })
      .expect(200);
    expect(prisma.reservation.findMany.mock.calls[0][0].where).toMatchObject({
      status: 'PENDING',
      expiresAt: { gt: expect.any(Date) },
    });
  });
  it('expired filter includes elapsed and null holds', async () => {
    await request(app.getHttpServer())
      .get('/admin/agenda?date=2031-01-10&status=EXPIRED')
      .auth(token(), { type: 'bearer' })
      .expect(200);
    expect(prisma.reservation.findMany.mock.calls[0][0].where.OR).toEqual([
      { status: 'EXPIRED' },
      {
        status: 'PENDING',
        OR: [{ expiresAt: { lte: expect.any(Date) } }, { expiresAt: null }],
      },
    ]);
  });
  it('includes inactive rooms in the administrator filter', async () => {
    await request(app.getHttpServer())
      .get('/admin/rooms')
      .auth(token(), { type: 'bearer' })
      .expect(200);
    expect(prisma.room.findMany.mock.calls[0][0]).not.toHaveProperty('where');
  });
  it('accepts leap days and handles month rollover', () => {
    expect(agendaDay('2032-02-29')).toEqual({
      start: new Date('2032-02-29T06:00:00Z'),
      end: new Date('2032-03-01T06:00:00Z'),
    });
  });
});
