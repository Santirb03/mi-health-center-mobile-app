import {
    IsNumber,
    IsOptional,
    IsString,
    Min,
    MinLength,
} from 'class-validator';

export class UpdateRoomDto {
    @IsOptional()
    @IsString()
    @MinLength(2)
    name?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsNumber()
    @Min(0)
    pricePerHour?: number;
}