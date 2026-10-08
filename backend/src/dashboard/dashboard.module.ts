import { Module } from '@nestjs/common';
import { AdminAccessGuard } from '../reservations/admin-access.guard';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, AdminAccessGuard],
})
export class DashboardModule {}
