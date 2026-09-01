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

describe('Backend adversarial audit E2E', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let roomId: string;
  let doctorAccessToken: string;
  let secondDoctorAccessToken: string;
  let adminAccessToken: string;

  let doctorUserId: string;
  let secondDoctorUserId: string;
  let adminUserId: string;

  const reservationIds: string[] = [];
  const patientIds: string[] = [];
  const blockIds: string[] = [];

  const password = 'Password123!';

  const registerAndLogin = async (
    prefix: string,
  ) => {
    const email = `${prefix}-${Date.now()}-${Math.random()}@test.com`;

    const registerResponse = await request(
      app.getHttpServer(),
    )
      .post('/auth/register')
      .send({
        email,
        password,
        firstName: 'Audit',
        lastName: prefix,
        phone: '4421234567',
        specialty: 'General Medicine',
      })
      .expect(201);

    const loginResponse = await request(
      app.getHttpServer(),
    )
      .post('/auth/login')
      .send({
        email,
        password,
      })
      .expect(201);

    return {
      email,
      userId: registerResponse.body.id as string,
      accessToken:
        loginResponse.body.accessToken as string,
    };
  };

  const findSlot = (
    body: {
      slots: Array<{
        startTime: string;
        available: boolean;
        blocked: boolean;
        blockReason: string | null;
      }>;
    },
    startTime: string,
  ) =>
    body.slots.find(
      (slot) => slot.startTime === startTime,
    );

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

    const room = await prisma.room.create({
      data: {
        name: `Audit Room ${Date.now()}`,
        description:
          'Room created for adversarial E2E auditing',
        pricePerHour: 500,
      },
    });

    roomId = room.id;

    const doctor = await registerAndLogin(
      'doctor',
    );
    doctorUserId = doctor.userId;
    doctorAccessToken = doctor.accessToken;

    const secondDoctor = await registerAndLogin(
      'doctor-two',
    );
    secondDoctorUserId = secondDoctor.userId;
    secondDoctorAccessToken =
      secondDoctor.accessToken;

    const admin = await registerAndLogin(
      'admin',
    );
    adminUserId = admin.userId;

    await prisma.user.update({
      where: {
        id: adminUserId,
      },
      data: {
        role: 'ADMIN',
      },
    });

    const adminLoginResponse = await request(
      app.getHttpServer(),
    )
      .post('/auth/login')
      .send({
        email: admin.email,
        password,
      })
      .expect(201);

    adminAccessToken =
      adminLoginResponse.body.accessToken;
  });

  afterAll(async () => {
    if (roomId) {
      await prisma.payment.deleteMany({
        where: {
          reservation: {
            roomId,
          },
        },
      });

      await prisma.reservation.deleteMany({
        where: {
          roomId,
        },
      });

      await prisma.roomBlock.deleteMany({
        where: {
          roomId,
        },
      });
    }

    if (patientIds.length > 0) {
      await prisma.patient.deleteMany({
        where: {
          id: {
            in: patientIds,
          },
        },
      });
    }

    const userIds = [
      doctorUserId,
      secondDoctorUserId,
      adminUserId,
    ].filter(Boolean);

    if (userIds.length > 0) {
      await prisma.user.deleteMany({
        where: {
          id: {
            in: userIds,
          },
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

  describe('authorization boundaries', () => {
    it('should reject a doctor trying to create a room block', async () => {
      await request(app.getHttpServer())
        .post(`/rooms/${roomId}/blocks`)
        .set(
          'Authorization',
          `Bearer ${doctorAccessToken}`,
        )
        .send({
          startTime:
            '2031-01-10T14:00:00.000Z',
          endTime:
            '2031-01-10T15:00:00.000Z',
          reason: 'Unauthorized test',
        })
        .expect(403);
    });

    it('should reject unauthenticated reservation creation', async () => {
      await request(app.getHttpServer())
        .post('/reservations')
        .send({
          roomId,
          startTime:
            '2031-01-10T14:00:00.000Z',
          endTime:
            '2031-01-10T15:00:00.000Z',
        })
        .expect(401);
    });
  });

  describe('patient ownership', () => {
    let patientId: string;

    it('should create a doctor-owned patient', async () => {
      const response = await request(
        app.getHttpServer(),
      )
        .post('/patients')
        .set(
          'Authorization',
          `Bearer ${doctorAccessToken}`,
        )
        .send({
          firstName: 'Ownership',
          lastName: 'Patient',
          phone: '4421234567',
          email: `ownership-${Date.now()}@test.com`,
          dateOfBirth: '1990-01-01',
        })
        .expect(201);

      patientId = response.body.id;
      patientIds.push(patientId);
    });

    it('should not allow another doctor to read the patient', async () => {
      await request(app.getHttpServer())
        .get(`/patients/${patientId}`)
        .set(
          'Authorization',
          `Bearer ${secondDoctorAccessToken}`,
        )
        .expect(404);
    });

    it('should not allow another doctor to update the patient', async () => {
      await request(app.getHttpServer())
        .patch(`/patients/${patientId}`)
        .set(
          'Authorization',
          `Bearer ${secondDoctorAccessToken}`,
        )
        .send({
          firstName: 'Stolen',
        })
        .expect(404);
    });
  });

  describe('availability and administrative blocks', () => {
    let blockId: string;

    it('should expose 13 one-hour slots from 08:00 to 21:00', async () => {
      const response = await request(
        app.getHttpServer(),
      )
        .get(
          `/rooms/${roomId}/availability?date=2031-01-11`,
        )
        .expect(200);

      expect(response.body.roomId).toBe(roomId);
      expect(response.body.timeZone).toBe(
        'America/Mexico_City',
      );
      expect(response.body.opensAt).toBe('08:00');
      expect(response.body.closesAt).toBe('21:00');
      expect(response.body.slots).toHaveLength(13);
      expect(response.body.slots[0].startTime).toBe(
        '08:00',
      );
      expect(
        response.body.slots[12].startTime,
      ).toBe('20:00');
      expect(response.body.slots[12].endTime).toBe(
        '21:00',
      );
    });

    it('should let an admin block a free slot', async () => {
      const response = await request(
        app.getHttpServer(),
      )
        .post(`/rooms/${roomId}/blocks`)
        .set(
          'Authorization',
          `Bearer ${adminAccessToken}`,
        )
        .send({
          startTime:
            '2031-01-11T14:00:00.000Z',
          endTime:
            '2031-01-11T15:00:00.000Z',
          reason: 'Maintenance audit',
        })
        .expect(201);

      blockId = response.body.id;
      blockIds.push(blockId);
    });

    it('should mark the blocked slot unavailable with its reason', async () => {
      const response = await request(
        app.getHttpServer(),
      )
        .get(
          `/rooms/${roomId}/availability?date=2031-01-11`,
        )
        .expect(200);

      const slot = findSlot(
        response.body,
        '08:00',
      );

      expect(slot).toBeDefined();
      expect(slot?.available).toBe(false);
      expect(slot?.blocked).toBe(true);
      expect(slot?.blockReason).toBe(
        'Maintenance audit',
      );
    });

    it('should reject a reservation that overlaps a room block', async () => {
      await request(app.getHttpServer())
        .post('/reservations')
        .set(
          'Authorization',
          `Bearer ${doctorAccessToken}`,
        )
        .send({
          roomId,
          startTime:
            '2031-01-11T14:00:00.000Z',
          endTime:
            '2031-01-11T15:00:00.000Z',
        })
        .expect(400);
    });

    it('should let the admin remove the room block', async () => {
      await request(app.getHttpServer())
        .delete(
          `/rooms/${roomId}/blocks/${blockId}`,
        )
        .set(
          'Authorization',
          `Bearer ${adminAccessToken}`,
        )
        .expect(200);

      blockIds.splice(
        blockIds.indexOf(blockId),
        1,
      );
    });

    it('should make the slot available again after block removal', async () => {
      const response = await request(
        app.getHttpServer(),
      )
        .get(
          `/rooms/${roomId}/availability?date=2031-01-11`,
        )
        .expect(200);

      const slot = findSlot(
        response.body,
        '08:00',
      );

      expect(slot).toBeDefined();
      expect(slot?.available).toBe(true);
      expect(slot?.blocked).toBe(false);
      expect(slot?.blockReason).toBeNull();
    });
  });

  describe('reservation expiration semantics', () => {
    it('should treat an active pending hold as unavailable', async () => {
      const doctor =
        await prisma.doctorProfile.findUniqueOrThrow({
          where: {
            userId: doctorUserId,
          },
        });

      const reservation =
        await prisma.reservation.create({
          data: {
            doctorId: doctor.id,
            roomId,
            startTime: new Date(
              '2031-01-12T14:00:00.000Z',
            ),
            endTime: new Date(
              '2031-01-12T15:00:00.000Z',
            ),
            totalPrice: 500,
            status: 'PENDING',
            expiresAt: new Date(
              Date.now() + 60_000,
            ),
          },
        });

      reservationIds.push(reservation.id);

      const response = await request(
        app.getHttpServer(),
      )
        .get(
          `/rooms/${roomId}/availability?date=2031-01-12`,
        )
        .expect(200);

      const slot = findSlot(
        response.body,
        '08:00',
      );

      expect(slot?.available).toBe(false);
    });

    it('should ignore an expired pending hold even if status is still PENDING', async () => {
      const doctor =
        await prisma.doctorProfile.findUniqueOrThrow({
          where: {
            userId: doctorUserId,
          },
        });

      const reservation =
        await prisma.reservation.create({
          data: {
            doctorId: doctor.id,
            roomId,
            startTime: new Date(
              '2031-01-13T14:00:00.000Z',
            ),
            endTime: new Date(
              '2031-01-13T15:00:00.000Z',
            ),
            totalPrice: 500,
            status: 'PENDING',
            expiresAt: new Date(
              Date.now() - 60_000,
            ),
          },
        });

      reservationIds.push(reservation.id);

      const response = await request(
        app.getHttpServer(),
      )
        .get(
          `/rooms/${roomId}/availability?date=2031-01-13`,
        )
        .expect(200);

      const slot = findSlot(
        response.body,
        '08:00',
      );

      expect(slot?.available).toBe(true);

      const databaseReservation =
        await prisma.reservation.findUniqueOrThrow({
          where: {
            id: reservation.id,
          },
        });

      expect(databaseReservation.status).toBe(
        'PENDING',
      );
    });

    it('should allow a new reservation over an expired pending hold', async () => {
      const response = await request(
        app.getHttpServer(),
      )
        .post('/reservations')
        .set(
          'Authorization',
          `Bearer ${secondDoctorAccessToken}`,
        )
        .send({
          roomId,
          startTime:
            '2031-01-13T14:00:00.000Z',
          endTime:
            '2031-01-13T15:00:00.000Z',
        })
        .expect(201);

      reservationIds.push(response.body.id);

      expect(response.body.status).toBe('PENDING');
      expect(response.body.expiresAt).toBeDefined();
    });
  });

  describe('reservation boundary validation', () => {
    it('should reject 07:00 to 08:00 local time', async () => {
      await request(app.getHttpServer())
        .post('/reservations')
        .set(
          'Authorization',
          `Bearer ${doctorAccessToken}`,
        )
        .send({
          roomId,
          startTime:
            '2031-01-14T13:00:00.000Z',
          endTime:
            '2031-01-14T14:00:00.000Z',
        })
        .expect(400);
    });

    it('should allow 20:00 to 21:00 local time', async () => {
      const response = await request(
        app.getHttpServer(),
      )
        .post('/reservations')
        .set(
          'Authorization',
          `Bearer ${doctorAccessToken}`,
        )
        .send({
          roomId,
          startTime:
            '2031-01-14T02:00:00.000Z',
          endTime:
            '2031-01-14T03:00:00.000Z',
        });

      // 02:00Z on Jan 14 is 20:00 local on Jan 13.
      // The service validates business-local time, not the UTC calendar date.
      expect(response.status).toBe(201);
      reservationIds.push(response.body.id);
    });

    it('should reject non-hour boundaries', async () => {
      await request(app.getHttpServer())
        .post('/reservations')
        .set(
          'Authorization',
          `Bearer ${doctorAccessToken}`,
        )
        .send({
          roomId,
          startTime:
            '2031-01-15T14:30:00.000Z',
          endTime:
            '2031-01-15T15:30:00.000Z',
        })
        .expect(400);
    });

    it('should allow adjacent non-overlapping reservations', async () => {
      const first = await request(
        app.getHttpServer(),
      )
        .post('/reservations')
        .set(
          'Authorization',
          `Bearer ${doctorAccessToken}`,
        )
        .send({
          roomId,
          startTime:
            '2031-01-16T14:00:00.000Z',
          endTime:
            '2031-01-16T15:00:00.000Z',
        })
        .expect(201);

      reservationIds.push(first.body.id);

      const second = await request(
        app.getHttpServer(),
      )
        .post('/reservations')
        .set(
          'Authorization',
          `Bearer ${secondDoctorAccessToken}`,
        )
        .send({
          roomId,
          startTime:
            '2031-01-16T15:00:00.000Z',
          endTime:
            '2031-01-16T16:00:00.000Z',
        })
        .expect(201);

      reservationIds.push(second.body.id);
    });
  });

  describe('database concurrency guarantee', () => {
    it('should allow exactly one winner when 20 requests reserve the same free slot concurrently', async () => {
      const concurrentRequests = Array.from(
        { length: 20 },
        (_, index) =>
          request(app.getHttpServer())
            .post('/reservations')
            .set(
              'Authorization',
              `Bearer ${
                index % 2 === 0
                  ? doctorAccessToken
                  : secondDoctorAccessToken
              }`,
            )
            .send({
              roomId,
              startTime:
                '2031-01-17T14:00:00.000Z',
              endTime:
                '2031-01-17T15:00:00.000Z',
            }),
      );

      const responses = await Promise.all(
        concurrentRequests,
      );

      for (const response of responses) {
        if (response.status === 201) {
          reservationIds.push(response.body.id);
        }
      }

      const successfulResponses = responses.filter(
        (response) => response.status === 201,
      );

      const rejectedResponses = responses.filter(
        (response) => response.status === 400,
      );

      const unexpectedResponses = responses.filter(
        (response) =>
          response.status !== 201 &&
          response.status !== 400,
      );

      expect(unexpectedResponses).toHaveLength(0);
      expect(successfulResponses).toHaveLength(1);
      expect(rejectedResponses).toHaveLength(19);

      const activeReservations =
        await prisma.reservation.findMany({
          where: {
            roomId,
            startTime: new Date(
              '2031-01-17T14:00:00.000Z',
            ),
            endTime: new Date(
              '2031-01-17T15:00:00.000Z',
            ),
            OR: [
              {
                status: 'CONFIRMED',
              },
              {
                status: 'PENDING',
                expiresAt: {
                  gt: new Date(),
                },
              },
            ],
          },
        });

      expect(activeReservations).toHaveLength(1);
    });
  });
});
