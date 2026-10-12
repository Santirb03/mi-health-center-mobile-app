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

    // Own the listener for the entire suite. Otherwise Supertest's first
    // concurrent request can close it while other requests are still running.
    await app.listen(0, '127.0.0.1');

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
      await prisma.refund.deleteMany({ where: { payment: { reservation: { roomId } } } });
      await prisma.refundSync.deleteMany({ where: { payment: { reservation: { roomId } } } });
    }
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

  describe('patients 5B search, validation and isolation', () => {
    let doctorId: string;
    let secondDoctorId: string;
    let privateId: string;
    let profilelessUserId: string;
    let profilelessToken: string;
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
    const orderBy = [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }] as const;
    beforeAll(async () => {
      doctorId = (await prisma.doctorProfile.findUniqueOrThrow({ where: { userId: doctorUserId } })).id;
      secondDoctorId = (await prisma.doctorProfile.findUniqueOrThrow({ where: { userId: secondDoctorUserId } })).id;
      const adminDoctorId = (await prisma.doctorProfile.findUniqueOrThrow({ where: { userId: adminUserId } })).id;
      await prisma.patient.createMany({ data: [
        ...Array.from({ length: 45 }, (_, index) => ({
          doctorId, firstName: index % 2 ? 'Page' : 'page',
          lastName: ['Same', 'Álvarez', 'Zulu'][index % 3],
        })),
        { doctorId, firstName: 'PrivateOnly', lastName: 'OwnerOnly', phone: '4421234567' },
        { doctorId: secondDoctorId, firstName: 'SecondOnly', lastName: 'OwnerOnly' },
        { doctorId: adminDoctorId, firstName: 'AdminOnly', lastName: 'OwnerOnly' },
        { doctorId, firstName: 'JohnCase', lastName: 'SmithCase', email: 'MixedCase@Example.com', phone: '4427654321' },
        { doctorId, firstName: 'ab%literal', lastName: 'Literal' },
        { doctorId, firstName: 'abXwildcard', lastName: 'Literal' },
        { doctorId, firstName: 'a_literal', lastName: 'Literal' },
        { doctorId, firstName: 'aXwildcard', lastName: 'Literal' },
        { doctorId, firstName: 'a\\literal', lastName: 'Literal' },
      ] });
      privateId = (await prisma.patient.findFirstOrThrow({ where: { doctorId, firstName: 'PrivateOnly' } })).id;
      const profileless = await registerAndLogin('patients-no-profile');
      profilelessUserId = profileless.userId;
      profilelessToken = profileless.accessToken;
      await prisma.doctorProfile.delete({ where: { userId: profilelessUserId } });
    });
    afterAll(async () => {
      if (profilelessUserId) await prisma.user.delete({ where: { id: profilelessUserId } });
    });
    it('paginates all rows in PostgreSQL order without duplicates, omissions or internal fields', async () => {
      const expected = await prisma.patient.findMany({ where: { doctorId }, orderBy: [...orderBy] });
      expect(expected.length).toBeGreaterThan(40);
      const collected: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const response = await request(app.getHttpServer()).get('/patients/page')
          .query(cursor ? { cursor } : {}).set(auth(doctorAccessToken)).expect(200);
        expect(response.body.items.length).toBeLessThanOrEqual(20);
        for (const item of response.body.items) {
          expect(Object.keys(item).sort()).toEqual([
            'id', 'firstName', 'lastName', 'phone', 'email', 'dateOfBirth', 'createdAt', 'updatedAt',
          ].sort());
          collected.push(item.id);
        }
        cursor = response.body.nextCursor;
        expect(++pages).toBeLessThan(10);
      } while (cursor !== null);
      expect(new Set(collected).size).toBe(collected.length);
      expect(collected).toEqual(expected.map(patient => patient.id));
      expect(pages).toBeGreaterThanOrEqual(3);
    });
    it('keeps legacy list responses and isolates both doctors and ADMIN with a doctor profile', async () => {
      for (const [userId, token] of [[doctorUserId, doctorAccessToken],
        [secondDoctorUserId, secondDoctorAccessToken], [adminUserId, adminAccessToken]]) {
        const profile = await prisma.doctorProfile.findUniqueOrThrow({ where: { userId } });
        const expected = await prisma.patient.findMany({ where: { doctorId: profile.id }, orderBy: [...orderBy] });
        const legacy = await request(app.getHttpServer()).get('/patients').set(auth(token)).expect(200);
        expect(Array.isArray(legacy.body)).toBe(true);
        expect(legacy.body.map((item: any) => item.id).sort()).toEqual(expected.map(item => item.id).sort());
        expect(legacy.body.every((item: any) => item.doctorId === profile.id)).toBe(true);
        const page = await request(app.getHttpServer()).get('/patients/page').set(auth(token)).expect(200);
        expect(page.body.items.map((item: any) => item.id)).toEqual(expected.slice(0, 20).map(item => item.id));
      }
    });
    it('never reveals foreign patients through search, IDs, edits or another owner cursor', async () => {
      for (const token of [secondDoctorAccessToken, adminAccessToken]) {
        const search = await request(app.getHttpServer()).get('/patients/page')
          .query({ q: 'PrivateOnly OwnerOnly' }).set(auth(token)).expect(200);
        expect(search.body).toEqual({ items: [], nextCursor: null });
        await request(app.getHttpServer()).get(`/patients/${privateId}`).set(auth(token)).expect(404);
        await request(app.getHttpServer()).patch(`/patients/${privateId}`).set(auth(token))
          .send({ firstName: 'Stolen' }).expect(404);
        const source = await request(app.getHttpServer()).get('/patients/page').set(auth(doctorAccessToken)).expect(200);
        expect(source.body.nextCursor).toEqual(expect.any(String));
        const page = await request(app.getHttpServer()).get('/patients/page')
          .query({ cursor: source.body.nextCursor }).set(auth(token)).expect(200);
        const profile = await prisma.doctorProfile.findUniqueOrThrow({
          where: { userId: token === adminAccessToken ? adminUserId : secondDoctorUserId },
        });
        const own = await prisma.patient.findMany({ where: { doctorId: profile.id } });
        expect(page.body.items.every((item: any) => own.some(patient => patient.id === item.id))).toBe(true);
      }
    });
    it('preserves missing-profile errors and requires authentication', async () => {
      await request(app.getHttpServer()).get('/patients/page').expect(401);
      for (const path of ['/patients', '/patients/page', `/patients/${privateId}`]) {
        const response = await request(app.getHttpServer()).get(path).set(auth(profilelessToken)).expect(404);
        expect(response.body.message).toBe('Doctor profile not found');
      }
    });
    it.each([
      [' johncase   SMITHCASE ', 'JohnCase'], ['mixedcase@example.com', 'JohnCase'],
      ['442765', 'JohnCase'], ['ab%', 'ab%literal'], ['a_', 'a_literal'], ['a\\', 'a\\literal'],
    ])('searches terms and literal wildcard characters: %s', async (q, firstName) => {
      const response = await request(app.getHttpServer()).get('/patients/page')
        .query({ q }).set(auth(doctorAccessToken)).expect(200);
      expect(response.body.items.map((item: any) => item.firstName)).toEqual([firstName]);
    });
    it('requires all search terms, supports four terms and paginates filtered searches', async () => {
      const response = await request(app.getHttpServer()).get('/patients/page')
        .query({ q: 'JohnCase SmithCase mixedcase@example.com 442765' }).set(auth(doctorAccessToken)).expect(200);
      expect(response.body.items).toHaveLength(1);
      const none = await request(app.getHttpServer()).get('/patients/page')
        .query({ q: 'JohnCase Zulu' }).set(auth(doctorAccessToken)).expect(200);
      expect(none.body.items).toEqual([]);
      const expected = await prisma.patient.findMany({ where: { doctorId,
        firstName: { contains: 'page', mode: 'insensitive' } }, orderBy: [...orderBy] });
      const ids: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 4; page++) {
        const result = await request(app.getHttpServer()).get('/patients/page')
          .query({ q: ' PAGE ', ...(cursor ? { cursor } : {}) }).set(auth(doctorAccessToken)).expect(200);
        ids.push(...result.body.items.map((item: any) => item.id));
        cursor = result.body.nextCursor;
        if (cursor === null) break;
      }
      expect(cursor).toBeNull();
      expect(ids).toEqual(expected.map(patient => patient.id));
      expect(new Set(ids).size).toBe(ids.length);
    });
    it.each(['x', '%', 'a'.repeat(81), 'one two three four five', '   '])('rejects query %s', async q => {
      await request(app.getHttpServer()).get('/patients/page').query({ q }).set(auth(doctorAccessToken)).expect(400);
    });
    it('rejects malformed cursors, foreign query fields and mismatched search', async () => {
      const source = await request(app.getHttpServer()).get('/patients/page')
        .query({ q: 'page' }).set(auth(doctorAccessToken)).expect(200);
      const mismatch = await request(app.getHttpServer()).get('/patients/page')
        .query({ q: 'same', cursor: source.body.nextCursor }).set(auth(doctorAccessToken)).expect(400);
      expect(mismatch.body.message).toBe('Invalid patient cursor');
      const malformed = await request(app.getHttpServer()).get('/patients/page')
        .query({ cursor: '??' }).set(auth(doctorAccessToken)).expect(400);
      expect(malformed.body.message).toBe('Invalid patient cursor');
      const oversized = await request(app.getHttpServer()).get('/patients/page')
        .query({ cursor: 'a'.repeat(2049) }).set(auth(doctorAccessToken)).expect(400);
      expect(oversized.body.message).toBe('Invalid patient cursor');
      await request(app.getHttpServer()).get('/patients/page')
        .query({ doctorId: secondDoctorId }).set(auth(doctorAccessToken)).expect(400);
    });
    it('normalizes creation, preserves response contract and clears date/contact to null', async () => {
      const created = await request(app.getHttpServer()).post('/patients').set(auth(doctorAccessToken)).send({
        firstName: ' Jane ', lastName: ' Doe ', phone: '+52 (442) 123-4567',
        email: ' Jane@Example.com ', dateOfBirth: '2000-02-29',
      }).expect(201);
      patientIds.push(created.body.id);
      expect(created.body).toMatchObject({ doctorId, firstName: 'Jane', lastName: 'Doe',
        phone: '+524421234567', email: 'Jane@Example.com', dateOfBirth: '2000-02-29T00:00:00.000Z' });
      for (const field of ['phone', 'email', 'dateOfBirth'] as const) {
        const patched = await request(app.getHttpServer()).patch(`/patients/${created.body.id}`)
          .set(auth(doctorAccessToken)).send({ [field]: null }).expect(200);
        expect(patched.body[field]).toBeNull();
        expect((await prisma.patient.findUniqueOrThrow({ where: { id: created.body.id } }))[field]).toBeNull();
      }
      const detail = await request(app.getHttpServer()).get(`/patients/${created.body.id}`)
        .set(auth(doctorAccessToken)).expect(200);
      expect(detail.body.doctorId).toBe(doctorId);
      for (const optional of [{}, { phone: null, email: null, dateOfBirth: null }]) {
        const response = await request(app.getHttpServer()).post('/patients').set(auth(doctorAccessToken))
          .send({ firstName: 'Jane', lastName: 'Doe', ...optional }).expect(201);
        patientIds.push(response.body.id);
        expect(response.body).toMatchObject({ phone: null, email: null, dateOfBirth: null });
      }
    });
    it.each([{}, { firstName: null }, { firstName: ' ' }, { doctorId: 'foreign' },
      { dateOfBirth: '2025-02-30' }, { dateOfBirth: '9999-01-01' },
      { dateOfBirth: '1899-12-31' }, { dateOfBirth: '1990-01-01T00:00:00Z' },
      { phone: '' }, { email: '' }])('rejects invalid patch %p', async body => {
      await request(app.getHttpServer()).patch(`/patients/${privateId}`)
        .set(auth(doctorAccessToken)).send(body).expect(400);
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

    it('should hide administrative notes in public availability but preserve admin access', async () => {
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
      expect(slot?.blockReason).toBeNull();
      expect(JSON.stringify(response.body)).not.toContain('Maintenance audit');

      await request(app.getHttpServer())
        .get(`/rooms/${roomId}/blocks`)
        .expect(401);
      await request(app.getHttpServer())
        .get(`/rooms/${roomId}/blocks`)
        .set('Authorization', `Bearer ${doctorAccessToken}`)
        .expect(403);
      const adminResponse = await request(app.getHttpServer())
        .get(`/rooms/${roomId}/blocks`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      expect(adminResponse.body).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: blockId, reason: 'Maintenance audit' }),
      ]));
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

      const results = await Promise.allSettled(
        concurrentRequests,
      );
      // Drain every request before assertions can trigger database cleanup.
      const responses = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );

      for (const response of responses) {
        if (response.status === 201) {
          reservationIds.push(response.body.id);
        }
      }

      expect(results.filter((result) => result.status === 'rejected')).toEqual([]);

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
