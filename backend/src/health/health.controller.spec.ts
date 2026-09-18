import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';

describe('Health HTTP', () => {
  let app: INestApplication;
  const query = jest.fn();
  beforeEach(async () => {
    query.mockReset();
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: { $queryRaw: query } }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    jest.useRealTimers();
    await app.close();
  });

  it('answers liveness without authentication or a database query', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200, { status: 'ok' })
      .expect('Cache-Control', 'no-store');
    expect(query).not.toHaveBeenCalled();
  });
  it('reports database success without caching', async () => {
    query.mockResolvedValue([{ value: 1 }]);
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200, { status: 'ok', database: 'up' })
      .expect('Cache-Control', 'no-store');
  });
  it('returns a sanitized 503 on failure and recovers on the next probe', async () => {
    query.mockRejectedValueOnce(
      new Error('postgresql://private:password@host/db'),
    );
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503, { status: 'unavailable', database: 'down' });
    query.mockResolvedValueOnce([]);
    await request(app.getHttpServer()).get('/health/ready').expect(200);
  });
  it('bounds stalled probes and shares their outstanding query', async () => {
    jest.useFakeTimers();
    let resolve!: (value: unknown) => void;
    query.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const controller = app.get(HealthController);
    const outcomes = Promise.allSettled([
      controller.ready(),
      controller.ready(),
    ]);
    await jest.advanceTimersByTimeAsync(2000);
    const results = await outcomes;
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    resolve([]);
    await Promise.resolve();
    await Promise.resolve();
  });
});
