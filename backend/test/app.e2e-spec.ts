import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Reservations E2E', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let email: string;
  let accessToken: string;
  let roomId: string;
  let reservationId: string;

  const password = 'Password123!';

  beforeAll(async () => {
    const moduleFixture: TestingModule =
      await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    prisma = app.get(PrismaService);

    email = `e2e-${Date.now()}@test.com`;

    const room = await prisma.room.create({
      data: {
        name: `E2E Room ${Date.now()}`,
        description: 'Room created for E2E testing',
        pricePerHour: 500,
      },
    });

    roomId = room.id;
  });

  afterAll(async () => {
    if (reservationId) {
      await prisma.payment.deleteMany({
        where: {
          reservationId,
        },
      });

      await prisma.reservation.delete({
        where: {
          id: reservationId,
        },
      });
    }

    if (roomId) {
      await prisma.room.delete({
        where: {
          id: roomId,
        },
      });
    }

    await app.close();
  });

  it('should register a new doctor', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email,
        password,
        firstName: 'E2E',
        lastName: 'Doctor',
        phone: '4421234567',
        specialty: 'General Medicine',
      })
      .expect(201);

    expect(response.body).toHaveProperty('id');
    expect(response.body.email).toBe(email);
    expect(response.body.role).toBe('DOCTOR');

    expect(response.body.doctorProfile).toBeDefined();
  });

  it('should login and return an access token', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email,
        password,
      })
      .expect(201);

    expect(response.body).toHaveProperty('accessToken');
    expect(typeof response.body.accessToken).toBe('string');
    expect(response.body.accessToken.length).toBeGreaterThan(0);

    accessToken = response.body.accessToken;
  });

  it('should return available rooms', async () => {
    const response = await request(app.getHttpServer())
      .get('/rooms')
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);

    const room = response.body.find(
      (room: { id: string }) => room.id === roomId,
    );

    expect(room).toBeDefined();
  });

  it('should create a reservation', async () => {
    const response = await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        roomId,
        startTime: '2030-01-10T10:00:00.000Z',
        endTime: '2030-01-10T12:00:00.000Z',
      })
      .expect(201);

    expect(response.body).toHaveProperty('id');
    expect(response.body.roomId).toBe(roomId);

    expect(response.body.totalPrice).toBe('1000');

    expect(response.body.status).toBe('PENDING');

    reservationId = response.body.id;
  });

  it('should return the doctor reservations', async () => {
    const response = await request(app.getHttpServer())
      .get('/reservations')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);

    const reservation = response.body.find(
      (reservation: { id: string }) =>
        reservation.id === reservationId,
    );

    expect(reservation).toBeDefined();
    expect(reservation.roomId).toBe(roomId);
  });

  it('should return a single reservation', async () => {
    const response = await request(app.getHttpServer())
      .get(`/reservations/${reservationId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.id).toBe(reservationId);
    expect(response.body.roomId).toBe(roomId);
    expect(response.body.status).toBe('PENDING');
  });

  it('should cancel the reservation', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/reservations/${reservationId}/cancel`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.id).toBe(reservationId);
    expect(response.body.status).toBe('CANCELLED');
  });
});
