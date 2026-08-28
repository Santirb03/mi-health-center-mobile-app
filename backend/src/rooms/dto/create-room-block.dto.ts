import {
    IsDateString,
    IsOptional,
    IsString,
} from 'class-validator';

export class CreateRoomBlockDto {
    @IsDateString()
    startTime: string;

    @IsDateString()
    endTime: string;

    @IsOptional()
    @IsString()
    reason?: string;
}