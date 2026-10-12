import { IsString, IsUUID, Matches, ValidateIf } from 'class-validator';

export class CreateAppointmentDto {
  @IsUUID() patientId: string;
  @IsUUID() reservationId: string;
  @IsString() startTime: string;
  @IsString() endTime: string;
}
export class RescheduleAppointmentDto {
  @IsString() startTime: string;
  @IsString() endTime: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID() reservationId?: string;
}
export class AppointmentPageDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID() patientId?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString() cursor?: string;
}
export class AppointmentCalendarDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) to: string;
}
