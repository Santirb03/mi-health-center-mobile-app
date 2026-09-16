import { Module } from '@nestjs/common';

import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { AdminAgendaController } from './admin-agenda.controller';
import { AdminAgendaService } from './admin-agenda.service';
import { AdminAccessGuard } from './admin-access.guard';

@Module({
  controllers: [ReservationsController, AdminAgendaController],
  providers: [ReservationsService, AdminAgendaService, AdminAccessGuard],
})
export class ReservationsModule { }
