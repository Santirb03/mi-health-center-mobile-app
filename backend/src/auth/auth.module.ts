import { Module } from '@nestjs/common';

import {
  ConfigModule,
  ConfigService,
} from '@nestjs/config';

import { JwtModule } from '@nestjs/jwt';

import { JwtStrategy } from './strategies/jwt.strategy';

import { AuthController } from './auth.controller';

import { AuthService } from './auth.service';
import { PASSWORD_RESET_DELIVERY, NoopPasswordResetDelivery } from './password-reset-delivery';
import { AuthRateLimitModule } from './auth-rate-limit.module';

@Module({
  imports: [
    AuthRateLimitModule,
    ConfigModule,

    JwtModule.registerAsync({
      imports: [ConfigModule],

      inject: [ConfigService],

      useFactory: (
        configService: ConfigService,
      ) => ({
        secret:
          configService.get<string>(
            'JWT_SECRET',
          ),

        signOptions: {
          expiresIn: '15m',
        },
      }),
    }),
  ],

  controllers: [
    AuthController,
  ],

  providers: [
    { provide: PASSWORD_RESET_DELIVERY, useClass: NoopPasswordResetDelivery },
    AuthService,
    JwtStrategy,
  ],
})
export class AuthModule { }
