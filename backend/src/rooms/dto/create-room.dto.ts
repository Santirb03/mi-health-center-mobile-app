import {
    IsNumber,
    IsOptional,
    IsString,
    Min,
    MinLength,
    Max,
    MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateRoomDto {
    @IsString()
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    @MinLength(2)
    @MaxLength(120)
    name: string;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    description?: string;

    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0.01)
    @Max(99999999.99)
    pricePerHour: number;
}
