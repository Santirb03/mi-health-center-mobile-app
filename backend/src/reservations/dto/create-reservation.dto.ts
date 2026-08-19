import {
    IsDateString,
    IsUUID,
} from 'class-validator';

export class CreateReservationDto {
    @IsUUID()
    roomId: string;

    @IsDateString()
    startTime: string;

    @IsDateString()
    endTime: string;
}