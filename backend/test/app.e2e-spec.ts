import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

jest.setTimeout(30000);

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

  afterAll(async () => {
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

