import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReservationDto } from './dto/create-reservation.dto';

const OPENING_HOUR = 8;
const CLOSING_HOUR = 21;

// Querétaro / Mexico City currently operates at UTC-06:00.
// This matches the timezone logic used by room availability.
const BUSINESS_TIMEZONE_OFFSET_HOURS = -6;

@Injectable()
export class ReservationsService {
    constructor(private readonly prisma: PrismaService) { }

    private getBusinessLocalDate(date: Date) {
        const localDate = new Date(
            date.getTime() +
            BUSINESS_TIMEZONE_OFFSET_HOURS *
            60 *
            60 *
            1000,
        );

        return {
            year: localDate.getUTCFullYear(),
            month: localDate.getUTCMonth(),
            day: localDate.getUTCDate(),
            hour: localDate.getUTCHours(),
        };
    }

    async create(
        userId: string,
        dto: CreateReservationDto,
    ) {
        const doctor =
            await this.prisma.doctorProfile.findUnique({
                where: {
                    userId,
                },
            });

        if (!doctor) {
            throw new NotFoundException(
                'Doctor profile not found',
            );
        }

        const room = await this.prisma.room.findUnique({
            where: {
                id: dto.roomId,
            },
        });

        if (!room || !room.active) {
            throw new NotFoundException(
                'Room not found or inactive',
            );
        }

        const startTime = new Date(dto.startTime);
        const endTime = new Date(dto.endTime);

        if (
            Number.isNaN(startTime.getTime()) ||
            Number.isNaN(endTime.getTime())
        ) {
            throw new BadRequestException(
                'Invalid date format',
            );
        }

        if (endTime <= startTime) {
            throw new BadRequestException(
                'End time must be after start time',
            );
        }

        /*
         * We compare absolute timestamps here.
         * If the reservation starts before or at the
         * current instant, it can no longer be booked.
         */
        if (startTime <= new Date()) {
            throw new BadRequestException(
                'Reservations cannot be made in the past',
            );
        }

        /*
         * Reservations must begin and finish exactly
         * on an hourly boundary.
         */
        if (
            startTime.getUTCMinutes() !== 0 ||
            startTime.getUTCSeconds() !== 0 ||
            startTime.getUTCMilliseconds() !== 0 ||
            endTime.getUTCMinutes() !== 0 ||
            endTime.getUTCSeconds() !== 0 ||
            endTime.getUTCMilliseconds() !== 0
        ) {
            throw new BadRequestException(
                'Reservations must start and end on a full hour',
            );
        }

        const localStart =
            this.getBusinessLocalDate(startTime);

        const localEnd =
            this.getBusinessLocalDate(endTime);

        /*
         * A reservation must start and finish
         * on the same local business day.
         */
        const sameBusinessDay =
            localStart.year === localEnd.year &&
            localStart.month === localEnd.month &&
            localStart.day === localEnd.day;

        if (!sameBusinessDay) {
            throw new BadRequestException(
                'Reservations must start and end on the same day',
            );
        }

        /*
         * Business hours:
         *
         * Opening: 08:00
         * Closing: 21:00
         *
         * Examples:
         * 08:00 -> 09:00 valid
         * 20:00 -> 21:00 valid
         * 07:00 -> 08:00 invalid
         * 21:00 -> 22:00 invalid
         */
        if (
            localStart.hour < OPENING_HOUR ||
            localStart.hour >= CLOSING_HOUR ||
            localEnd.hour > CLOSING_HOUR
        ) {
            throw new BadRequestException(
                'Reservations must be within business hours from 08:00 to 21:00',
            );
        }

        const conflictingReservation =
            await this.prisma.reservation.findFirst({
                where: {
                    roomId: dto.roomId,
                    status: {
                        in: [
                            'PENDING',
                            'CONFIRMED',
                        ],
                    },
                    startTime: {
                        lt: endTime,
                    },
                    endTime: {
                        gt: startTime,
                    },
                },
            });

        if (conflictingReservation) {
            throw new BadRequestException(
                'Room is already reserved for the selected time',
            );
        }

        const durationInHours =
            (endTime.getTime() -
                startTime.getTime()) /
            (1000 * 60 * 60);

        const totalPrice =
            Number(room.pricePerHour) *
            durationInHours;

        const reservation =
            await this.prisma.reservation.create({
                data: {
                    doctorId: doctor.id,
                    roomId: room.id,
                    startTime,
                    endTime,
                    totalPrice,
                },
            });

        return reservation;
    }

    async findAll(userId: string) {
        const doctor =
            await this.prisma.doctorProfile.findUnique({
                where: {
                    userId,
                },
            });

        if (!doctor) {
            throw new NotFoundException(
                'Doctor profile not found',
            );
        }

        return this.prisma.reservation.findMany({
            where: {
                doctorId: doctor.id,
            },
            include: {
                room: true,
            },
            orderBy: {
                startTime: 'asc',
            },
        });
    }

    async findOne(
        userId: string,
        reservationId: string,
    ) {
        const doctor =
            await this.prisma.doctorProfile.findUnique({
                where: {
                    userId,
                },
            });

        if (!doctor) {
            throw new NotFoundException(
                'Doctor profile not found',
            );
        }

        const reservation =
            await this.prisma.reservation.findFirst({
                where: {
                    id: reservationId,
                    doctorId: doctor.id,
                },
                include: {
                    room: true,
                },
            });

        if (!reservation) {
            throw new NotFoundException(
                'Reservation not found',
            );
        }

        return reservation;
    }

    async cancel(
        userId: string,
        reservationId: string,
    ) {
        const doctor =
            await this.prisma.doctorProfile.findUnique({
                where: {
                    userId,
                },
            });

        if (!doctor) {
            throw new NotFoundException(
                'Doctor profile not found',
            );
        }

        const reservation =
            await this.prisma.reservation.findFirst({
                where: {
                    id: reservationId,
                    doctorId: doctor.id,
                },
            });

        if (!reservation) {
            throw new NotFoundException(
                'Reservation not found',
            );
        }

        if (
            reservation.status === 'CANCELLED'
        ) {
            throw new BadRequestException(
                'Reservation is already cancelled',
            );
        }

        if (
            reservation.status === 'COMPLETED'
        ) {
            throw new BadRequestException(
                'Completed reservations cannot be cancelled',
            );
        }

        return this.prisma.reservation.update({
            where: {
                id: reservation.id,
            },
            data: {
                status: 'CANCELLED',
            },
        });
    }
}