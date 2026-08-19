import {
    IsDateString,
    IsEmail,
    IsOptional,
    IsString,
    MinLength,
} from 'class-validator';

export class CreatePatientDto {
    @IsString()
    @MinLength(2)
    firstName: string;

    @IsString()
    @MinLength(2)
    lastName: string;

    @IsOptional()
    @IsString()
    phone?: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsDateString()
    dateOfBirth?: string;
}