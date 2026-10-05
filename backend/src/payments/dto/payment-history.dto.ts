import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PaymentHistoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}
