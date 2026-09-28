import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Internal notifications', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let otherToken: string;
  let doctorId: string;
  let roomId: string;
  let reservationId: string;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); await app.init();
    prisma = app.get(PrismaService);
    for (const suffix of ['owner', 'other']) {
      const email = `notifications-${suffix}-${Date.now()}@example.invalid`;
      const password = 'Password123!';
      const registered = await request(app.getHttpServer()).post('/auth/register').send({ email, password, firstName: 'Test', lastName: 'Doctor' }).expect(201);
      const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(201);
      if (suffix === 'owner') { token = login.body.accessToken; doctorId = registered.body.doctorProfile.id; }
      else otherToken = login.body.accessToken;
    }
    const room = await prisma.room.create({ data: { name: 'Notification test', pricePerHour: 100 } }); roomId = room.id;
    const reservation = await prisma.reservation.create({ data: { doctorId, roomId, totalPrice: 100, startTime: new Date('2035-01-01T15:00:00Z'), endTime: new Date('2035-01-01T16:00:00Z') } });
    reservationId = reservation.id;
  });
  afterAll(async () => { await app?.close(); });

  it('requires authentication', async () => { await request(app.getHttpServer()).get('/notifications').expect(401); });
  it('does not notify pending reservations; rolls back an aborted confirmation', async () => {
    await expect(prisma.$transaction(async tx => {
      await tx.reservation.update({ where: { id: reservationId }, data: { status: 'CONFIRMED' } });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await prisma.notification.count({ where: { reservationId } })).toBe(0);
  });
  it('creates only one notice for repeated confirmation and protects ownership', async () => {
    for (let i = 0; i < 2; i++) await prisma.reservation.update({ where: { id: reservationId }, data: { status: 'CONFIRMED' } });
    const inbox = await request(app.getHttpServer()).get('/notifications').auth(token, { type: 'bearer' }).expect(200);
    expect(inbox.body.unreadCount).toBe(1); expect(inbox.body.items).toHaveLength(1);
    const id = inbox.body.items[0].id;
    const other = await request(app.getHttpServer()).get('/notifications').auth(otherToken, { type: 'bearer' }).expect(200);
    expect(other.body.items).toHaveLength(0);
    await request(app.getHttpServer()).patch(`/notifications/${id}/read`).auth(otherToken, { type: 'bearer' }).expect(404);
    await request(app.getHttpServer()).patch('/notifications/read-all').auth(otherToken, { type: 'bearer' }).expect(200);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id } })).readAt).toBeNull();
    await request(app.getHttpServer()).patch(`/notifications/${id}/read`).auth(token, { type: 'bearer' }).expect(200);
    const first = (await prisma.notification.findUniqueOrThrow({ where: { id } })).readAt;
    await request(app.getHttpServer()).patch(`/notifications/${id}/read`).auth(token, { type: 'bearer' }).expect(200);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id } })).readAt).toEqual(first);
    const read = await request(app.getHttpServer()).get('/notifications').auth(token, { type: 'bearer' }).expect(200);
    expect(read.body.unreadCount).toBe(0);
  });
  it('adds one internal refund notice despite repeated status updates', async () => {
    const payment = await prisma.payment.create({ data: { reservationId, amount: 100, status: 'PAID' } });
    for (let i = 0; i < 2; i++) await prisma.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED' } });
    expect(await prisma.notification.count({ where: { eventKey: `${payment.id}:REFUNDED` } })).toBe(1);
  });
});
