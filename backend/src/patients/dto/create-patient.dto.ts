import {
    IsEmail,
    IsOptional,
    IsString,
    IsPhoneNumber,
    Length,
    MaxLength,
} from 'class-validator';
import { IsBirthDate, NormalizePhone, TrimText } from './patient-validation';

export class CreatePatientDto {
    @TrimText()
    @IsString()
    @Length(2, 80)
    firstName: string;

    @TrimText()
    @IsString()
    @Length(2, 80)
    lastName: string;

    @IsOptional()
    @NormalizePhone()
    @IsString()
    @MaxLength(40)
    @IsPhoneNumber('MX')
    phone?: string | null;

    @IsOptional()
    @TrimText()
    @IsEmail()
    @MaxLength(254)
    email?: string | null;

    @IsOptional()
    @IsBirthDate()
    dateOfBirth?: string | null;
}
