import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60000, limit: 10, blockDuration: 60000 }],
      errorMessage: 'Demasiados intentos. Espera un minuto e intenta de nuevo.',
    }),
  ],
  exports: [ThrottlerModule],
})
export class AuthRateLimitModule {}
