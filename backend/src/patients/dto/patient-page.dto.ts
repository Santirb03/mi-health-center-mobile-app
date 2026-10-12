import { IsString, MaxLength, ValidateIf } from 'class-validator';
import { TrimText } from './patient-validation';

export class PatientPageDto {
  @ValidateIf((_object, value) => value !== undefined)
  @TrimText()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  cursor?: string;
}
