import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReservationPageDto {
  @IsIn(['pending', 'confirmed', 'history'])
  group: 'pending' | 'confirmed' | 'history';

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}
