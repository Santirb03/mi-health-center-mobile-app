import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { Client } from 'pg';

jest.setTimeout(40000);
const start = '2090-01-01T15:00:00.000Z';
const end = '2090-01-01T16:00:00.000Z';
const shifted = (minutes: number) => new Date(Date.parse(start) + minutes * 60000).toISOString();
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
async function barrier(promise: Promise<void>) {
  let timer: ReturnType<typeof setTimeout>;
  try { await Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Lock barrier timeout')), 8000); })]); }
  finally { clearTimeout(timer!); }
}
describe('Appointments HTTP and PostgreSQL guarantees', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const owners: { userId: string; doctorId: string; token: string; patientId: string; reservationId: string }[] = [];
  const rooms: string[] = [];
  let otherReservation: string;
  const auth = (index = 0) => ({ Authorization: `Bearer ${owners[index].token}` });
  const body = (overrides = {}) => ({ patientId: owners[0].patientId, reservationId: owners[0].reservationId, startTime: start, endTime: end, ...overrides });
  const post = (overrides = {}, index = 0) => request(app.getHttpServer()).post('/appointments').set(auth(index)).send(body(overrides));
  const patch = (id: string, suffix = '', data = {}) => request(app.getHttpServer()).patch(`/appointments/${id}${suffix}`).set(auth()).send(data);
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    for (let i = 0; i < 2; i++) rooms.push((await prisma.room.create({ data: { name: `Appointment fixture ${i}`, pricePerHour: 100 } })).id);
    for (let i = 0; i < 3; i++) {
      const email = `appointments-${randomUUID()}@example.invalid`;
      const password = 'Password123!';
      const registered = await request(app.getHttpServer()).post('/auth/register').send({ email, password, firstName: 'Test', lastName: 'Doctor' }).expect(201);
      const userId = registered.body.id;
      if (i === 2) await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
      const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(201);
      const doctorId = (await prisma.doctorProfile.findUniqueOrThrow({ where: { userId } })).id;
      const patientId = (await prisma.patient.create({ data: { doctorId, firstName: 'Synthetic', lastName: 'Patient', phone: '4421234567', email: 'private@example.invalid' } })).id;
      const reservationId = (await prisma.reservation.create({ data: { doctorId, roomId: rooms[i === 0 ? 0 : 1],
        startTime: new Date('2090-01-01T14:00:00Z'), endTime: new Date('2090-01-01T22:00:00Z'), status: 'CONFIRMED', totalPrice: 100 } })).id;
      owners.push({ userId, doctorId, patientId, reservationId, token: login.body.accessToken });
    }
    otherReservation = (await prisma.reservation.create({ data: { doctorId: owners[0].doctorId, roomId: rooms[1],
      startTime: new Date('2090-01-01T14:00:00Z'), endTime: new Date('2090-01-01T22:00:00Z'), status: 'CONFIRMED', totalPrice: 100 } })).id;
  });
  beforeEach(async () => {
    await prisma.appointment.deleteMany({ where: { doctorId: { in: owners.map(owner => owner.doctorId) } } });
    await prisma.reservation.updateMany({ where: { doctorId: { in: owners.map(owner => owner.doctorId) } }, data: { status: 'CONFIRMED' } });
  });
  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { doctorId: { in: owners.map(owner => owner.doctorId) } } });
    await prisma.reservation.deleteMany({ where: { doctorId: { in: owners.map(owner => owner.doctorId) } } });
    await prisma.user.deleteMany({ where: { id: { in: owners.map(owner => owner.userId) } } });
    await prisma.room.deleteMany({ where: { id: { in: rooms } } });
    await app.close();
  });
  it('creates an explicitly projected view and derives room', async () => {
    const response = await post().expect(201);
    expect(Object.keys(response.body).sort()).toEqual(['id', 'status', 'startTime', 'endTime', 'createdAt', 'updatedAt', 'patient', 'reservation', 'needsRoomReview'].sort());
    expect(Object.keys(response.body.patient).sort()).toEqual(['id', 'firstName', 'lastName'].sort());
    expect(response.body.status).toBe('SCHEDULED');
    expect(response.body.needsRoomReview).toBe(false);
    expect(response.body.reservation.room.id).toBe(rooms[0]);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: response.body.id } })).roomId).toBe(rooms[0]);
  });
  it('requires JWT, owner resources and UUIDs; ADMIN has no global access', async () => {
    await request(app.getHttpServer()).get('/appointments/page').expect(401);
    const created = await post().expect(201);
    for (const i of [1, 2]) {
      await request(app.getHttpServer()).get(`/appointments/${created.body.id}`).set(auth(i)).expect(404);
      for (const suffix of ['', '/cancel', '/complete'])
        await request(app.getHttpServer()).patch(`/appointments/${created.body.id}${suffix}`).set(auth(i))
          .send(suffix ? {} : { startTime: start, endTime: end }).expect(404);
      await post({ patientId: owners[0].patientId, reservationId: owners[i].reservationId }, i).expect(404);
      await post({ patientId: owners[i].patientId }, i).expect(404);
      const own = await post({ patientId: owners[i].patientId, reservationId: owners[i].reservationId }, i).expect(201);
      const list = await request(app.getHttpServer()).get('/appointments/page').set(auth(i)).expect(200);
      expect(list.body.items.map((item: any) => item.id)).toEqual([own.body.id]);
    }
    await request(app.getHttpServer()).get('/appointments/not-uuid').set(auth()).expect(400);
    await post({ patientId: 'not-uuid' }).expect(400);
    await request(app.getHttpServer()).get('/appointments/page').query({ patientId: owners[1].patientId }).set(auth()).expect(404);
  });
  it('preserves missing-profile error', async () => {
    const profile = await prisma.doctorProfile.findUniqueOrThrow({ where: { id: owners[2].doctorId } });
    await prisma.reservation.deleteMany({ where: { doctorId: profile.id } });
    await prisma.patient.deleteMany({ where: { doctorId: profile.id } });
    await prisma.doctorProfile.delete({ where: { id: profile.id } });
    try {
      const response = await request(app.getHttpServer()).get('/appointments/page').set(auth(2)).expect(404);
      expect(response.body.message).toBe('Doctor profile not found');
    } finally {
      await prisma.doctorProfile.create({ data: profile });
      owners[2].patientId = (await prisma.patient.create({ data: { doctorId: profile.id, firstName: 'Synthetic', lastName: 'Patient' } })).id;
      owners[2].reservationId = (await prisma.reservation.create({ data: { doctorId: profile.id, roomId: rooms[1],
        startTime: new Date('2090-01-01T14:00:00Z'), endTime: new Date('2090-01-01T22:00:00Z'), status: 'CONFIRMED', totalPrice: 100 } })).id;
    }
  });
  it.each(['PENDING', 'CANCELLED'] as const)('rejects own %s reservation', async status => {
    await prisma.reservation.update({ where: { id: owners[0].reservationId }, data: { status } });
    await post().expect(409);
  });
  it.each([{ notes: 'not accepted' }, { doctorId: 'not accepted' }, { roomId: 'not accepted' },
    { startTime: '2090-01-01T15:00:00' }, { startTime: '2090-02-30T15:00:00Z' },
    { startTime: '2000-01-01T15:00:00Z' }, { endTime: start }, { endTime: shifted(14) },
    { endTime: shifted(241) }, { startTime: shifted(1) }, { startTime: '2090-01-01T15:00:01Z' },
    { startTime: '2090-01-01T15:00:00.001Z' }, { endTime: '2090-01-01T22:05:00Z', startTime: '2090-01-01T21:45:00Z' }])(
    'rejects invalid or unknown body %p', async overrides => { await post(overrides).expect(400); },
  );
  it('rejects outside containment even when duration/precision are valid', async () => {
    await post({ startTime: '2090-01-01T21:45:00Z', endTime: '2090-01-01T22:05:00Z' }).expect(400);
  });
  it('allows consecutive intervals; cancelled frees time; completed continues blocking', async () => {
    const first = await post().expect(201);
    await post({ startTime: end, endTime: shifted(75) }).expect(201);
    const conflict = await post().expect(409);
    expect(conflict.body.message).toBe('Appointment overlaps another appointment');
    await patch(first.body.id, '/cancel').expect(200);
    await patch(first.body.id, '/cancel').expect(200);
    await patch(first.body.id, '/complete').expect(409);
    const replacement = await post().expect(201);
    await prisma.appointment.update({ where: { id: replacement.body.id }, data: { status: 'COMPLETED' } });
    await post().expect(409);
    await patch(replacement.body.id, '/cancel').expect(409);
    await patch(replacement.body.id, '/complete').expect(200);
  });
  it('only completes after start; legacy scheduled without reservation needs review', async () => {
    const future = await post().expect(201);
    await patch(future.body.id, '/complete').expect(409);
    const oldStart = new Date(Math.floor(Date.now() / 300000) * 300000 - 300000);
    const legacy = await prisma.appointment.create({ data: { doctorId: owners[0].doctorId, patientId: owners[0].patientId,
      startTime: oldStart, endTime: new Date(oldStart.getTime() + 30 * 60000) } });
    const detail = await request(app.getHttpServer()).get(`/appointments/${legacy.id}`).set(auth()).expect(200);
    expect(detail.body.reservation).toBeNull(); expect(detail.body.needsRoomReview).toBe(true);
    await patch(legacy.id, '', { startTime: start, endTime: end, reservationId: otherReservation }).expect(409);
    const completed = await patch(legacy.id, '/complete').expect(200);
    expect(completed.body.needsRoomReview).toBe(false);
    await patch(legacy.id, '/complete').expect(200);
    await patch(legacy.id, '/cancel').expect(409);
  });
  it('reschedules to another room, excludes self and rejects begun/terminal or unpaired edits', async () => {
    const created = await post().expect(201);
    await patch(created.body.id, '', { startTime: start }).expect(400);
    const moved = await patch(created.body.id, '', { startTime: shifted(120), endTime: shifted(150), reservationId: otherReservation }).expect(200);
    expect(moved.body.reservation.room.id).toBe(rooms[1]);
    await post({ startTime: shifted(120), endTime: shifted(150) }).expect(409);
    await patch(created.body.id, '', { startTime: shifted(120), endTime: shifted(150) }).expect(200);
    await patch(created.body.id, '/cancel').expect(200);
    await patch(created.body.id, '', { startTime: start, endTime: end }).expect(409);
  });
  it('five concurrent creations have exactly one winner on clean repetitions', async () => {
    for (let round = 0; round < 3; round++) {
      await prisma.appointment.deleteMany({ where: { doctorId: owners[0].doctorId } });
      const results = await Promise.all(Array.from({ length: 5 }, () => post().then(response => response.status)));
      expect(results.filter(status => status === 201)).toHaveLength(1);
      expect(results.filter(status => status === 409)).toHaveLength(4);
      expect(await prisma.appointment.count({ where: { doctorId: owners[0].doctorId, status: { not: 'CANCELLED' } } })).toBe(1);
    }
  });
  it('different doctors can create concurrently and concurrent reschedules have one winner', async () => {
    const results = await Promise.all([post(), post({ patientId: owners[1].patientId, reservationId: owners[1].reservationId }, 1)]);
    expect(results.map(result => result.status)).toEqual([201, 201]);
    const second = await post({ startTime: shifted(60), endTime: shifted(90) }).expect(201);
    const moved = await Promise.all([results[0].body.id, second.body.id].map(id => patch(id, '', { startTime: shifted(120), endTime: shifted(150), reservationId: otherReservation })));
    expect(moved.map(response => response.status).sort()).toEqual([200, 409]);
  });
  it('enforces EXCLUDE, owner FKs and CHECK through direct SQL', async () => {
    await post().expect(201);
    const connection = new Client({ connectionString: process.env.DATABASE_URL });
    await connection.connect();
    const insert = (doctorId: string, patientId: string, reservationId: string | null, from = start, to = end) => connection.query(
      'INSERT INTO appointments (id, "doctorId", "patientId", "reservationId", "startTime", "endTime", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,NOW())',
      [randomUUID(), doctorId, patientId, reservationId, from, to]);
    try {
      await expect(insert(owners[0].doctorId, owners[0].patientId, owners[0].reservationId)).rejects.toMatchObject({ code: '23P01' });
      await expect(insert(owners[0].doctorId, owners[1].patientId, owners[0].reservationId, shifted(120), shifted(135))).rejects.toMatchObject({ code: '23503' });
      await expect(insert(owners[0].doctorId, owners[0].patientId, owners[1].reservationId, shifted(120), shifted(135))).rejects.toMatchObject({ code: '23503' });
      await expect(insert(owners[0].doctorId, owners[0].patientId, owners[0].reservationId, shifted(120), shifted(120))).rejects.toMatchObject({ code: '23514' });
    } finally { await connection.end(); }
  });
  it('keyset pages preserve all states, tie order, ownership and cursor filter', async () => {
    await prisma.appointment.createMany({ data: Array.from({ length: 45 }, (_, i) => ({ doctorId: owners[0].doctorId,
      patientId: owners[0].patientId, startTime: new Date(shifted(Math.floor(i / 3) * 30)),
      endTime: new Date(shifted(Math.floor(i / 3) * 30 + 15)),
      status: i % 3 === 0 ? (i === 0 ? 'SCHEDULED' : 'COMPLETED') : 'CANCELLED' })) });
    const expected = await prisma.appointment.findMany({ where: { doctorId: owners[0].doctorId }, orderBy: [{ startTime: 'desc' }, { id: 'desc' }] });
    const ids: string[] = []; let cursor: string | null = null;
    for (let page = 0; page < 4; page++) {
      const result = await request(app.getHttpServer()).get('/appointments/page').set(auth())
        .query({ patientId: owners[0].patientId, ...(cursor ? { cursor } : {}) }).expect(200);
      expect(result.body.items.length).toBeLessThanOrEqual(20);
      ids.push(...result.body.items.map((item: any) => item.id)); cursor = result.body.nextCursor;
      if (!cursor) break;
    }
    expect(cursor).toBeNull(); expect(new Set(ids).size).toBe(45); expect(ids).toEqual(expected.map(row => row.id));
    expect(new Set(expected.map(row => row.status))).toEqual(new Set(['SCHEDULED', 'COMPLETED', 'CANCELLED']));
    const first = await request(app.getHttpServer()).get('/appointments/page').query({ patientId: owners[0].patientId }).set(auth()).expect(200);
    await request(app.getHttpServer()).get('/appointments/page').query({ cursor: first.body.nextCursor }).set(auth()).expect(400);
    const bad = await request(app.getHttpServer()).get('/appointments/page').query({ cursor: '?' }).set(auth()).expect(400);
    expect(bad.body.message).toBe('Invalid appointment cursor');
    const foreign = await request(app.getHttpServer()).get('/appointments/page').query({ cursor: first.body.nextCursor, patientId: owners[1].patientId }).set(auth(1)).expect(400);
    expect(foreign.body.message).toBe('Invalid appointment cursor');
  });
  it('calendar uses UTC-06 overlap, excludes cancelled, limits range and signals truncation', async () => {
    await prisma.appointment.createMany({ data: Array.from({ length: 301 }, (_, i) => ({ doctorId: owners[0].doctorId,
      patientId: owners[0].patientId, startTime: new Date(Date.parse('2090-01-01T00:00:00Z') + i * 15 * 60000),
      endTime: new Date(Date.parse('2090-01-01T00:15:00Z') + i * 15 * 60000) })) });
    const result = await request(app.getHttpServer()).get('/appointments/calendar').query({ from: '2089-12-31', to: '2090-01-04' }).set(auth()).expect(200);
    expect(result.body.items).toHaveLength(300); expect(result.body.truncated).toBe(true);
    const day = await request(app.getHttpServer()).get('/appointments/calendar').query({ from: '2089-12-31', to: '2089-12-31' }).set(auth()).expect(200);
    expect(day.body.items).toHaveLength(24);
    const last = day.body.items[23];
    await prisma.appointment.update({ where: { id: last.id }, data: { status: 'CANCELLED' } });
    const filtered = await request(app.getHttpServer()).get('/appointments/calendar').query({ from: '2089-12-31', to: '2089-12-31' }).set(auth()).expect(200);
    expect(filtered.body.items).toHaveLength(23);
    await request(app.getHttpServer()).get('/appointments/calendar').query({ from: '2090-01-01', to: '2090-01-15' }).set(auth()).expect(400);
    await request(app.getHttpServer()).get('/appointments/calendar').query({ from: '2090-01-02', to: '2090-01-01' }).set(auth()).expect(400);
  });
  it.each(['appointment-first', 'cancel-first'])('coordinates reservation race: %s', async order => {
    const held = gate(), waiter = gate(), release = gate();
    const originalTransaction = prisma.$transaction.bind(prisma);
    const spy = jest.spyOn(prisma, '$transaction').mockImplementation(((work: any, options: any) => originalTransaction(async tx => {
      let doctorLocked = false;
      const wrapped = new Proxy(tx, { get(target, key) {
        if (key !== '$executeRaw') return Reflect.get(target, key);
        return async (strings: TemplateStringsArray, ...values: any[]) => {
          const sql = strings.join('');
          if (sql.includes('7101')) { doctorLocked = true; return target.$executeRaw(strings, ...values); }
          if (!sql.includes('pg_advisory_xact_lock')) return target.$executeRaw(strings, ...values);
          const isHolder = (order === 'appointment-first') === doctorLocked;
          if (!isHolder) waiter.resolve();
          const result = await target.$executeRaw(strings, ...values);
          if (isHolder) { held.resolve(); await release.promise; }
          return result;
        };
      } });
      return work(wrapped);
    }, options)) as any);
    let creation: Promise<request.Response> | undefined;
    let cancellation: Promise<request.Response> | undefined;
    const cancel = () => request(app.getHttpServer()).patch(`/reservations/${owners[0].reservationId}/cancel`).set(auth()).then(response => response);
    try {
      if (order === 'appointment-first') creation = post().then(response => response);
      else cancellation = cancel();
      await barrier(held.promise);
      if (order === 'appointment-first') cancellation = cancel();
      else creation = post().then(response => response);
      await barrier(waiter.promise); release.resolve();
      const [created, cancelled] = await Promise.all([creation!, cancellation!]);
      expect(cancelled.status).toBe(200);
      expect(created.status).toBe(order === 'appointment-first' ? 201 : 409);
      expect(await prisma.appointment.count({ where: { doctorId: owners[0].doctorId } })).toBe(order === 'appointment-first' ? 1 : 0);
      if (created.status === 201) {
        const detail = await request(app.getHttpServer()).get(`/appointments/${created.body.id}`).set(auth()).expect(200);
        expect(detail.body.needsRoomReview).toBe(true); expect(detail.body.status).toBe('SCHEDULED');
      }
      expect(await prisma.refund.count({ where: { payment: { reservationId: owners[0].reservationId } } })).toBe(0);
    } finally { release.resolve(); await Promise.allSettled([creation, cancellation].filter(Boolean)); spy.mockRestore(); }
  });
});
