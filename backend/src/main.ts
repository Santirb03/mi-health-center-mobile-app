import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const proxies = app.get(ConfigService).get<string>('TRUST_PROXY_IPS');
  app.set('trust proxy', proxies ? proxies.split(',').map((ip) => ip.trim()) : false);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(app.get(ConfigService).getOrThrow<number>('PORT'));
}

bootstrap();
