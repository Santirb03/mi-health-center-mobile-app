import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminAccessGuard } from './admin-access.guard';
import { AdminAgendaService } from './admin-agenda.service';
import { AgendaQueryDto } from './dto/agenda-query.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminAccessGuard)
export class AdminAgendaController {
  constructor(private readonly agenda: AdminAgendaService) {}

  @Get('agenda')
  list(@Query() query: AgendaQueryDto) {
    return this.agenda.list(query);
  }

  @Get('rooms')
  rooms() {
    return this.agenda.rooms();
  }
}
