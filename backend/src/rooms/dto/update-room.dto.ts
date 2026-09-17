import {
    IsNumber,
    ValidateIf,
    IsBoolean,
    Max,
    MaxLength,
    IsString,
    Min,
    MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateRoomDto {
    @ValidateIf((_, value) => value !== undefined)
    @IsString()
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    @MinLength(2)
    @MaxLength(120)
    name?: string;

    @ValidateIf((_, value) => value !== undefined)
    @IsString()
    @MaxLength(2000)
    description?: string;

    @ValidateIf((_, value) => value !== undefined)
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0.01)
    @Max(99999999.99)
    pricePerHour?: number;

    @ValidateIf((_, value) => value !== undefined)
    @IsBoolean()
    active?: boolean;
}
