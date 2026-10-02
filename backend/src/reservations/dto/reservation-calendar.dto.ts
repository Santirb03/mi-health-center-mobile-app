import { IsString, Matches } from 'class-validator';

export class ReservationCalendarDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to: string;
}
