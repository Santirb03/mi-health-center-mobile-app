import { Module } from '@nestjs/common';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { AdminAccessGuard } from '../reservations/admin-access.guard';

@Module({
  controllers: [RoomsController],
  providers: [RoomsService, AdminAccessGuard],
})
export class RoomsModule { }
