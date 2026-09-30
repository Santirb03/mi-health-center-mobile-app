import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { PASSWORD_RESET_DELIVERY } from '../src/auth/password-reset-delivery';
import type { PasswordResetDelivery } from '../src/auth/password-reset-delivery';
import {
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

jest.setTimeout(30000);

describe('Password reset E2E', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;
  let email: string;
  let sent: Array<Parameters<PasswordResetDelivery['sendPasswordReset']>[0]>;
  const oldPassword = 'OriginalPassword123!';
  const newPassword = 'ReplacementPassword123!';
  const genericError = 'Invalid or expired reset token';

  beforeEach(async () => {
    // Fresh application also isolates the real per-endpoint rate limits.
    sent = [];
    userId = '';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PASSWORD_RESET_DELIVERY)
      .useValue({ sendPasswordReset: async (input: typeof sent[number]) => { sent.push(input); } })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    email = `password-reset-${randomUUID()}@test.com`;
    const user = await prisma.user.create({ data: { email, passwordHash: await argon2.hash(oldPassword) } });
    userId = user.id;
  });

  afterEach(async () => {
    try {
      if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    } finally {
      await app?.close();
      sent = [];
    }
  });

  const forgot = () => request(app.getHttpServer()).post('/auth/forgot-password').send({ email }).expect(201);
  const reset = (token: string, password = newPassword) =>
    request(app.getHttpServer()).post('/auth/reset-password').send({ token, password });
  const login = (password: string) => request(app.getHttpServer()).post('/auth/login').send({ email, password });

  it('returns the same public response for known and unknown emails', async () => {
    const known = await forgot();
    const unknown = await request(app.getHttpServer()).post('/auth/forgot-password')
      .send({ email: `missing-${randomUUID()}@test.com` });
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    expect(known.body).toEqual({ message: 'If an account exists for that email, password reset instructions will be sent' });
    expect(sent).toHaveLength(1);
  });

  it('changes the password and rejects the refresh token issued before reset', async () => {
    const previous = await login(oldPassword).expect(201);
    await forgot();
    await reset(sent[0].token).expect(201, { message: 'Password reset successfully' });
    // Check before a successful new login can rotate the refresh hash itself.
    await request(app.getHttpServer()).post('/auth/refresh')
      .send({ refreshToken: previous.body.refreshToken }).expect(401);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).refreshTokenHash).toBeNull();
    await login(oldPassword).expect(401);
    await login(newPassword).expect(201);
  });

  it('rejects reuse of the same reset token without changing the password again', async () => {
    await forgot();
    await reset(sent[0].token).expect(201);
    const second = await reset(sent[0].token, 'AnotherPassword123!').expect(400);
    expect(second.body.message).toBe(genericError);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await argon2.verify(user.passwordHash, newPassword)).toBe(true);
    expect((await prisma.passwordResetToken.findUniqueOrThrow({ where: { userId } })).usedAt).not.toBeNull();
  });

  it('invalidates the old token when another reset is requested', async () => {
    await forgot();
    await forgot();
    expect(sent[0].token).not.toBe(sent[1].token);
    const old = await reset(sent[0].token).expect(400);
    expect(old.body.message).toBe(genericError);
    await reset(sent[1].token).expect(201);
  });

  it('rejects an expired token with the generic error', async () => {
    await forgot();
    await prisma.passwordResetToken.update({ where: { userId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const response = await reset(sent[0].token).expect(400);
    expect(response.body.message).toBe(genericError);
  });

  it('allows only one concurrent reset and stores the winning password', async () => {
    await forgot();
    const passwords = [newPassword, 'OtherConcurrentPassword123!'];
    const responses = await Promise.all(passwords.map(password => reset(sent[0].token, password)));
    expect(responses.map(response => response.status).sort()).toEqual([201, 400]);
    const winner = responses.findIndex(response => response.status === 201);
    expect(responses[1 - winner].body.message).toBe(genericError);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await argon2.verify(user.passwordHash, passwords[winner])).toBe(true);
    expect(await argon2.verify(user.passwordHash, passwords[1 - winner])).toBe(false);
  });

  it('validates DTOs and enforces the forgot-password limit', async () => {
    await request(app.getHttpServer()).post('/auth/forgot-password').send({ email: 'invalid' }).expect(400);
    for (let i = 0; i < 4; i++) await forgot();
    await request(app.getHttpServer()).post('/auth/forgot-password').send({ email }).expect(429);
    await request(app.getHttpServer()).post('/auth/reset-password').send({ token: 42, password: 'short' }).expect(400);
  });

  it('enforces the reset-password limit', async () => {
    for (let i = 0; i < 10; i++) await reset('invalid-token').expect(400);
    await reset('invalid-token').expect(429);
  });
});

describe('Backend E2E', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let email: string;
  let secondDoctorEmail: string;

  let accessToken: string;
  let refreshToken: string;
  let secondDoctorAccessToken: string;

  let oldRefreshToken: string;

  let roomId: string;
  let reservationId: string;
  let paymentReservationId: string;
  let patientId: string;

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

  it('reports readiness using the disposable PostgreSQL database', async () => {
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect('Cache-Control', 'no-store')
      .expect(200, { status: 'ok', database: 'up' });
  });

  afterAll(async () => {
    if (roomId) {
      await prisma.refund.deleteMany({ where: { payment: { reservation: { roomId } } } });
      await prisma.refundSync.deleteMany({ where: { payment: { reservation: { roomId } } } });
    }
    if (patientId) {
      await prisma.patient.delete({
        where: {
          id: patientId,
        },
      });
    }

    if (paymentReservationId) {
      await prisma.payment.deleteMany({
        where: {
          reservationId: paymentReservationId,
        },
      });

      await prisma.reservation.delete({
        where: {
          id: paymentReservationId,
        },
      });
    }

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
    expect(response.body.doctorProfile.firstName).toBe('E2E');
    expect(response.body.doctorProfile.lastName).toBe('Doctor');
  });

  it('returns 201 and 409 for concurrent registrations with the same email', async () => {
    const concurrentEmail = `concurrent-register-${randomUUID()}@test.com`;
    const payload = {
      email: concurrentEmail, password,
      firstName: 'Concurrent', lastName: 'Doctor',
    };
    try {
      const [first, second] = await Promise.all([
        request(app.getHttpServer()).post('/auth/register').send(payload),
        request(app.getHttpServer()).post('/auth/register').send(payload),
      ]);
      expect([first.status, second.status].sort()).toEqual([201, 409]);
      const conflict = [first, second].find(response => response.status === 409)!;
      expect(conflict.body.message).toBe('Email already registered');
      expect(await prisma.user.count({ where: { email: concurrentEmail } })).toBe(1);
    } finally {
      await prisma.user.deleteMany({ where: { email: concurrentEmail } });
    }
  });

  it('should login and return access and refresh tokens', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email,
        password,
      })
      .expect(201);

    expect(response.body).toHaveProperty('accessToken');
    expect(response.body).toHaveProperty('refreshToken');
    expect(typeof response.body.accessToken).toBe('string');
    expect(typeof response.body.refreshToken).toBe('string');
    expect(response.body.accessToken.length).toBeGreaterThan(0);
    expect(response.body.refreshToken.length).toBeGreaterThan(0);

    accessToken = response.body.accessToken;
    refreshToken = response.body.refreshToken;
  });

  it('should refresh the tokens', async () => {
    oldRefreshToken = refreshToken;

    const response = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({
        refreshToken,
      })
      .expect(201);

    expect(response.body).toHaveProperty('accessToken');
    expect(response.body).toHaveProperty('refreshToken');
    expect(typeof response.body.accessToken).toBe('string');
    expect(typeof response.body.refreshToken).toBe('string');
    expect(response.body.accessToken).not.toBe(accessToken);
    expect(response.body.refreshToken).not.toBe(refreshToken);

    accessToken = response.body.accessToken;
    refreshToken = response.body.refreshToken;
  });

  it('should reject the old refresh token after rotation', async () => {
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({
        refreshToken: oldRefreshToken,
      })
      .expect(401);
  });

  it('should return available rooms', async () => {
    const response = await request(app.getHttpServer())
      .get('/rooms')
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);

    const room = response.body.find(
      (room: { id: string }) =>
        room.id === roomId,
    );

    expect(room).toBeDefined();
  });

  it('should create a reservation', async () => {
    const response = await request(app.getHttpServer())
      .post('/reservations')
      .set(
        'Authorization',
        `Bearer ${accessToken}`,
      )
      .send({
        roomId,
        startTime: '2030-01-10T14:00:00.000Z',
        endTime: '2030-01-10T15:00:00.000Z',
      })
      .expect(201);

    expect(response.body).toHaveProperty('id');
    expect(response.body.roomId).toBe(roomId);
    expect(response.body.totalPrice).toBe('500');
    expect(response.body.status).toBe('PENDING');

    reservationId = response.body.id;
  });

  it('should return the doctor reservations', async () => {
    const response = await request(app.getHttpServer())
      .get('/reservations')
      .set(
        'Authorization',
        `Bearer ${accessToken}`,
      )
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
      .set(
        'Authorization',
        `Bearer ${accessToken}`,
      )
      .expect(200);

    expect(response.body.id).toBe(reservationId);
    expect(response.body.roomId).toBe(roomId);
    expect(response.body.status).toBe('PENDING');
  });

  it('should register a second doctor', async () => {
    secondDoctorEmail = `e2e-second-${Date.now()}@test.com`;

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: secondDoctorEmail,
        password,
        firstName: 'Second',
        lastName: 'Doctor',
        phone: '4421111111',
        specialty: 'Cardiology',
      })
      .expect(201);

    expect(response.body).toHaveProperty('id');
    expect(response.body.email).toBe(secondDoctorEmail);
    expect(response.body.role).toBe('DOCTOR');
    expect(response.body.doctorProfile).toBeDefined();
  });

  it('should login the second doctor', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: secondDoctorEmail,
        password,
      })
      .expect(201);

    expect(response.body).toHaveProperty('accessToken');
    expect(typeof response.body.accessToken).toBe('string');
    expect(response.body.accessToken.length).toBeGreaterThan(0);

    secondDoctorAccessToken =
      response.body.accessToken;
  });

  it('paginates tied dates without duplicates and scopes every cursor to the authenticated doctor', async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { email }, include: { doctorProfile: true } });
    const doctorId = owner.doctorProfile!.id;
    const fixtureIds: string[] = [];
    try {
      const date = new Date('2035-01-01T15:00:00Z');
      for (let index = 0; index < 45; index++) {
        const row = await prisma.reservation.create({ data: {
          doctorId, roomId, startTime: date, endTime: new Date('2035-01-01T16:00:00Z'),
          totalPrice: 500, status: 'CANCELLED',
        } });
        fixtureIds.push(row.id);
      }
      const page = (cursor?: string, bearer = accessToken) => request(app.getHttpServer())
        .get('/reservations/page').query({ group: 'history', ...(cursor ? { cursor } : {}) })
        .auth(bearer, { type: 'bearer' }).expect(200);
      const first = (await page()).body;
      expect(first.items).toHaveLength(20);
      expect(first.nextCursor).toEqual(expect.any(String));
      const other = (await page(first.nextCursor, secondDoctorAccessToken)).body;
      expect(other).toEqual({ items: [], nextCursor: null });
      // A newer insertion must not shift the next page as offset pagination would.
      const newer = await prisma.reservation.create({ data: {
        doctorId, roomId, startTime: new Date('2036-01-01T15:00:00Z'),
        endTime: new Date('2036-01-01T16:00:00Z'), totalPrice: 500, status: 'CANCELLED',
      } });
      fixtureIds.push(newer.id);
      const second = (await page(first.nextCursor)).body;
      const third = (await page(second.nextCursor)).body;
      expect(second.items).toHaveLength(20);
      expect(third.items).toHaveLength(5);
      expect(third.nextCursor).toBeNull();
      const ids = [...first.items, ...second.items, ...third.items].map((row: { id: string }) => row.id);
      expect(new Set(ids).size).toBe(45);
      expect(ids).toEqual(fixtureIds.slice(0, 45).sort().reverse());
    } finally {
      await prisma.reservation.deleteMany({ where: { id: { in: fixtureIds } } });
    }
  });

  it('should not allow a doctor to view another doctor reservation', async () => {
    await request(app.getHttpServer())
      .get(`/reservations/${reservationId}`)
      .set(
        'Authorization',
        `Bearer ${secondDoctorAccessToken}`,
      )
      .expect(404);
  });

  it('should not allow a doctor to cancel another doctor reservation', async () => {
    await request(app.getHttpServer())
      .patch(
        `/reservations/${reservationId}/cancel`,
      )
      .set(
        'Authorization',
        `Bearer ${secondDoctorAccessToken}`,
      )
      .expect(404);
  });

  it('should cancel the reservation', async () => {
    const response = await request(app.getHttpServer())
      .patch(
        `/reservations/${reservationId}/cancel`,
      )
      .set(
        'Authorization',
        `Bearer ${accessToken}`,
      )
      .expect(200);

    expect(response.body.id).toBe(reservationId);
    expect(response.body.status).toBe('CANCELLED');
  });

  it('should create a patient', async () => {
    const response = await request(app.getHttpServer())
      .post('/patients')
      .set(
        'Authorization',
        `Bearer ${accessToken}`,
      )
      .send({
        firstName: 'John',
        lastName: 'Doe',
        phone: '4421234567',
        email: 'john.e2e@test.com',
        dateOfBirth: '1990-01-01',
      })
      .expect(201);

    expect(response.body).toHaveProperty('id');
    expect(response.body.firstName).toBe('John');
    expect(response.body.lastName).toBe('Doe');
    expect(response.body.phone).toBe('4421234567');
    expect(response.body.email).toBe('john.e2e@test.com');

    patientId = response.body.id;
  });

  it('should return the doctor patients', async () => {
    const response = await request(app.getHttpServer())
      .get('/patients')
      .set(
        'Authorization',
        `Bearer ${accessToken}`,
      )
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);

    const patient = response.body.find(
      (patient: { id: string }) =>
        patient.id === patientId,
    );

    expect(patient).toBeDefined();
    expect(patient.firstName).toBe('John');
    expect(patient.lastName).toBe('Doe');
  });

  it('should return a single patient', async () => {
    const response = await request(app.getHttpServer())
      .get(`/patients/${patientId}`)
      .set(
        'Authorization',
        `Bearer ${accessToken}`,
      )
      .expect(200);

    expect(response.body.id).toBe(patientId);
    expect(response.body.firstName).toBe('John');
    expect(response.body.lastName).toBe('Doe');
  });

  it('should update the patient', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/patients/${patientId}`)
      .set(
        'Authorization',
        `Bearer ${accessToken}`,
      )
      .send({
        firstName: 'Jonathan',
        phone: '4429876543',
      })
      .expect(200);

    expect(response.body.id).toBe(patientId);
    expect(response.body.firstName).toBe('Jonathan');
    expect(response.body.phone).toBe('4429876543');
  });

  it('should create a reservation for payment testing', async () => {
    const response = await request(app.getHttpServer())
      .post('/reservations')
      .set(
        'Authorization',
        `Bearer ${accessToken}`,
      )
      .send({
        roomId,
        startTime: '2030-01-11T14:00:00.000Z',
        endTime: '2030-01-11T15:00:00.000Z',
      })
      .expect(201);

    expect(response.body).toHaveProperty('id');
    expect(response.body.roomId).toBe(roomId);
    expect(response.body.totalPrice).toBe('500');
    expect(response.body.status).toBe('PENDING');

    paymentReservationId = response.body.id;
  });

  it('should reject payment for another doctor reservation', async () => {
    await request(app.getHttpServer())
      .post(
        `/payments/reservations/${paymentReservationId}`,
      )
      .set(
        'Authorization',
        `Bearer ${secondDoctorAccessToken}`,
      )
      .expect(404);
  });

  it('should create a Stripe payment intent', async () => {
    const response = await request(app.getHttpServer())
      .post(
        `/payments/reservations/${paymentReservationId}`,
      )
      .set(
        'Authorization',
        `Bearer ${accessToken}`,
      )
      .expect(201);

    expect(response.body).toHaveProperty('clientSecret');
    expect(response.body).toHaveProperty('paymentIntentId');
    expect(typeof response.body.clientSecret).toBe('string');
    expect(response.body.clientSecret.length).toBeGreaterThan(0);
    expect(typeof response.body.paymentIntentId).toBe('string');
    expect(response.body.paymentIntentId.length).toBeGreaterThan(0);

    const payment =
      await prisma.payment.findUnique({
        where: {
          reservationId: paymentReservationId,
        },
      });

    expect(payment).toBeDefined();
    expect(payment?.status).toBe('PENDING');
    expect(payment?.provider).toBe('stripe');
    expect(payment?.transactionId).toBe(
      response.body.paymentIntentId,
    );
  });

  it('should return the existing Stripe payment intent', async () => {
    const firstResponse = await request(
      app.getHttpServer(),
    )
      .post(
        `/payments/reservations/${paymentReservationId}`,
      )
      .set(
        'Authorization',
        `Bearer ${accessToken}`,
      )
      .expect(201);

    const secondResponse = await request(
      app.getHttpServer(),
    )
      .post(
        `/payments/reservations/${paymentReservationId}`,
      )
      .set(
        'Authorization',
        `Bearer ${accessToken}`,
      )
      .expect(201);

    expect(
      secondResponse.body.paymentIntentId,
    ).toBe(firstResponse.body.paymentIntentId);

    expect(
      secondResponse.body.clientSecret,
    ).toBe(firstResponse.body.clientSecret);
  });

  it('should reject payment without authentication', async () => {
    await request(app.getHttpServer())
      .post(
        `/payments/reservations/${paymentReservationId}`,
      )
      .expect(401);
  });

  it('should reject payment for a cancelled reservation', async () => {
    const response = await request(
      app.getHttpServer(),
    )
      .post('/reservations')
      .set(
        'Authorization',
        `Bearer ${accessToken}`,
      )
      .send({
        roomId,
        startTime: '2030-01-12T14:00:00.000Z',
        endTime: '2030-01-12T15:00:00.000Z',
      })
      .expect(201);

    const cancelledReservationId =
      response.body.id;

    await request(app.getHttpServer())
      .patch(
        `/reservations/${cancelledReservationId}/cancel`,
      )
      .set(
        'Authorization',
        `Bearer ${accessToken}`,
      )
      .expect(200);

    await request(app.getHttpServer())
      .post(
        `/payments/reservations/${cancelledReservationId}`,
      )
      .set(
        'Authorization',
        `Bearer ${accessToken}`,
      )
      .expect(400);

    await prisma.payment.deleteMany({
      where: {
        reservationId: cancelledReservationId,
      },
    });

    await prisma.reservation.delete({
      where: {
        id: cancelledReservationId,
      },
    });
  });

  it('should logout successfully', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/logout')
      .set(
        'Authorization',
        `Bearer ${accessToken}`,
      )
      .expect(201);

    expect(response.body).toEqual({
      message: 'Logged out successfully',
    });
  });

  it('should reject the refresh token after logout', async () => {
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({
        refreshToken,
      })
      .expect(401);
  });
});

