import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { RoomsModule } from './rooms/rooms.module';
import { ReservationsModule } from './reservations/reservations.module';
import { PatientsModule } from './patients/patients.module';
import { PaymentsModule } from './payments/payments.module';
import { validateEnvironment } from './config/environment';
import { HealthController } from './health/health.controller';
import { HttpObservabilityModule } from './observability/http-observability.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
      ignoreEnvFile: process.env.E2E_INTEGRATION_ISOLATED === '1',
    }),
    PrismaModule,
    HttpObservabilityModule,
    AuthModule,
    RoomsModule,
    ReservationsModule,
    PatientsModule,
    PaymentsModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule { }
