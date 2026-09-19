import {
  BadRequestException,
  Controller,
  Get,
  INestApplication,
  Logger,
  Post,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HttpObservabilityModule } from './http-observability.module';

@Controller('probe')
class ProbeController {
  @Get() ok() {
    return { ok: true };
  }
  @Post(':id') fail() {
    throw new Error('secret-in-exception');
  }
  @Get('invalid') invalid() {
    throw new BadRequestException('Invalid input');
  }
}

describe('HTTP diagnostics privacy', () => {
  let app: INestApplication;
  let error: jest.SpyInstance;
  let warn: jest.SpyInstance;
  beforeEach(async () => {
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const module = await Test.createTestingModule({
      imports: [HttpObservabilityModule],
      controllers: [ProbeController],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  it('preserves malformed JSON as a client error without echoing input', async () => {
    const response = await request(app.getHttpServer())
      .post('/probe/private')
      .set('Content-Type', 'application/json')
      .send('{"password":"private-secret"')
      .expect(400);
    expect(JSON.stringify(response.body)).not.toContain('private-secret');
    expect(JSON.stringify(error.mock.calls)).not.toContain('private-secret');
  });

  it('generates independent identifiers even when a client supplies one', async () => {
    const a = await request(app.getHttpServer())
      .get('/probe')
      .set('X-Request-Id', 'untrusted')
      .expect(200);
    const b = await request(app.getHttpServer()).get('/probe').expect(200);
    expect(a.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
  it('correlates a failure without logging request data or exception text', async () => {
    const response = await request(app.getHttpServer())
      .post('/probe/private-id?email=private-email')
      .set('Authorization', 'Bearer private-token')
      .set('Cookie', 'private-cookie')
      .send({ password: 'private-password' })
      .expect(500);
    expect(error).toHaveBeenCalledTimes(1);
    const record = JSON.parse(error.mock.calls[0][0]);
    expect(record).toEqual({
      event: 'http_request_failed',
      requestId: response.headers['x-request-id'],
      method: 'POST',
      route: '/probe/:id',
      statusCode: 500,
      durationMs: expect.any(Number),
    });
    for (const secret of [
      'private-id',
      'private-email',
      'private-token',
      'private-cookie',
      'private-password',
      'secret-in-exception',
    ]) {
      expect(JSON.stringify(error.mock.calls)).not.toContain(secret);
      expect(JSON.stringify(response.body)).not.toContain(secret);
    }
  });
  it('preserves client errors and hides unmatched URLs in logs', async () => {
    await request(app.getHttpServer())
      .get('/probe/invalid')
      .expect(400)
      .expect(({ body }) => expect(body.message).toBe('Invalid input'));
    await request(app.getHttpServer())
      .get('/private-unknown?token=secret')
      .expect(404);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.parse(warn.mock.calls[1][0]).route).toBe('unmatched');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-unknown');
    expect(error).not.toHaveBeenCalled();
  });
});
