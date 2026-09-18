import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRateLimitModule } from './auth-rate-limit.module';

describe('authentication HTTP limits', () => {
  let app: NestExpressApplication;
  const service = { login: jest.fn(), register: jest.fn(), refresh: jest.fn() };
  beforeEach(async () => {
    for (const method of Object.values(service))
      method.mockReset().mockResolvedValue({ ok: true });
    const module = await Test.createTestingModule({
      imports: [AuthRateLimitModule],
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: service }],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    await app.listen(0, '127.0.0.1');
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it.each([
    ['login', 10],
    ['register', 5],
    ['refresh', 60],
  ] as const)(
    'limits %s before invoking the service and includes retry guidance',
    async (route, limit) => {
      for (let index = 0; index < limit; index++) {
        await request(app.getHttpServer())
          .post(`/auth/${route}`)
          .send({})
          .expect(201);
      }
      const blocked = await request(app.getHttpServer())
        .post(`/auth/${route}`)
        .send({})
        .expect(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(blocked.body.message).toContain('Demasiados intentos');
      expect(service[route]).toHaveBeenCalledTimes(limit);
    },
  );
  it('counts failed logins, ignores forged forwarding headers, separates routes and recovers', async () => {
    service.login.mockRejectedValue(new UnauthorizedException());
    for (let index = 0; index < 10; index++) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', `203.0.113.${index + 1}`)
        .send({})
        .expect(401);
    }
    await request(app.getHttpServer()).post('/auth/login').send({}).expect(429);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({})
      .expect(201);
    const later = Date.now() + 61000;
    jest.spyOn(Date, 'now').mockReturnValue(later);
    service.login.mockResolvedValue({ ok: true });
    await request(app.getHttpServer()).post('/auth/login').send({}).expect(201);
  });
  it('keeps distinct clients independent behind an explicitly trusted proxy', async () => {
    app.set('trust proxy', ['127.0.0.1']);
    for (let index = 0; index < 10; index++) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', '203.0.113.1')
        .send({})
        .expect(201);
    }
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '203.0.113.1')
      .send({})
      .expect(429);
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '203.0.113.2')
      .send({})
      .expect(201);
  });
});
