import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto, RescheduleAppointmentDto, AppointmentPageDto, AppointmentCalendarDto } from './dto/appointment.dto';

@Controller('appointments')
@UseGuards(JwtAuthGuard)
export class AppointmentsController {
  constructor(private readonly service: AppointmentsService) {}
  @Post() create(@Req() req: { user: { userId: string } }, @Body() dto: CreateAppointmentDto) { return this.service.create(req.user.userId, dto); }
  @Get('calendar') calendar(@Req() req: { user: { userId: string } }, @Query() dto: AppointmentCalendarDto) { return this.service.calendar(req.user.userId, dto); }
  @Get('page') page(@Req() req: { user: { userId: string } }, @Query() dto: AppointmentPageDto) { return this.service.page(req.user.userId, dto); }
  @Get(':id') findOne(@Req() req: { user: { userId: string } }, @Param('id', ParseUUIDPipe) id: string) { return this.service.findOne(req.user.userId, id); }
  @Patch(':id') reschedule(@Req() req: { user: { userId: string } }, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RescheduleAppointmentDto) { return this.service.reschedule(req.user.userId, id, dto); }
  @Patch(':id/cancel') cancel(@Req() req: { user: { userId: string } }, @Param('id', ParseUUIDPipe) id: string) { return this.service.cancel(req.user.userId, id); }
  @Patch(':id/complete') complete(@Req() req: { user: { userId: string } }, @Param('id', ParseUUIDPipe) id: string) { return this.service.complete(req.user.userId, id); }
}
