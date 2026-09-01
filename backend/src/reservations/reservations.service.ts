import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { CreateReservationDto } from './dto/create-reservation.dto';

const OPENING_HOUR = 8;
const CLOSING_HOUR = 21;

const PENDING_HOLD_MINUTES = 8;

// Querétaro / Mexico City currently operates at UTC-06:00.
// This matches the timezone logic used by room availability.
const BUSINESS_TIMEZONE_OFFSET_HOURS = -6;

@Injectable()
export class ReservationsService {
    constructor(
        private readonly prisma: PrismaService,
    ) { }

    private getBusinessLocalDate(
        date: Date,
    ) {
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

        const room =
            await this.prisma.room.findUnique({
                where: {
                    id: dto.roomId,
                },
            });

        if (!room || !room.active) {
            throw new NotFoundException(
                'Room not found or inactive',
            );
        }

        const startTime =
            new Date(dto.startTime);

        const endTime =
            new Date(dto.endTime);

        if (
            Number.isNaN(
                startTime.getTime(),
            ) ||
            Number.isNaN(
                endTime.getTime(),
            )
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

        /**
         * We compare absolute timestamps here.
         * If the reservation starts before or at the
         * current instant, it can no longer be booked.
         */
        const now = new Date();

        if (startTime <= now) {
            throw new BadRequestException(
                'Reservations cannot be made in the past',
            );
        }

        /**
         * Reservations must begin and finish exactly
         * on an hourly boundary.
         */
        if (
            startTime.getUTCMinutes() !== 0 ||
            startTime.getUTCSeconds() !== 0 ||
            startTime.getUTCMilliseconds() !==
            0 ||
            endTime.getUTCMinutes() !== 0 ||
            endTime.getUTCSeconds() !== 0 ||
            endTime.getUTCMilliseconds() !==
            0
        ) {
            throw new BadRequestException(
                'Reservations must start and end on a full hour',
            );
        }

        const localStart =
            this.getBusinessLocalDate(
                startTime,
            );

        const localEnd =
            this.getBusinessLocalDate(
                endTime,
            );

        /**
         * A reservation must start and finish
         * on the same local business day.
         */
        const sameBusinessDay =
            localStart.year ===
            localEnd.year &&
            localStart.month ===
            localEnd.month &&
            localStart.day ===
            localEnd.day;

        if (!sameBusinessDay) {
            throw new BadRequestException(
                'Reservations must start and end on the same day',
            );
        }

        /**
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
            localStart.hour <
            OPENING_HOUR ||
            localStart.hour >=
            CLOSING_HOUR ||
            localEnd.hour >
            CLOSING_HOUR
        ) {
            throw new BadRequestException(
                'Reservations must be within business hours from 08:00 to 21:00',
            );
        }

        return this.prisma.$transaction(async (tx) => {
            /**
             * Serialize every reservation/block mutation for
             * the same room using a transaction-scoped PostgreSQL
             * advisory lock.
             *
             * The lock is automatically released when this transaction
             * commits or rolls back. Requests for different rooms can
             * still execute concurrently.
             */
            await tx.$executeRaw`
                SELECT pg_advisory_xact_lock(hashtext(${room.id}))
            `;

            /**
             * Recalculate now after acquiring the lock. A request
             * may have waited behind another transaction.
             */
            const lockedNow = new Date();

            if (startTime <= lockedNow) {
                throw new BadRequestException(
                    'Reservations cannot be made in the past',
                );
            }

            /**
             * Check overlap against reservations that are
             * currently occupying the room.
             *
             * CONFIRMED reservations always block the slot.
             * PENDING reservations only block while expiresAt
             * is still in the future.
             */
            const conflictingReservation =
                await tx.reservation.findFirst({
                    where: {
                        roomId: dto.roomId,
                        startTime: {
                            lt: endTime,
                        },
                        endTime: {
                            gt: startTime,
                        },
                        OR: [
                            {
                                status: 'CONFIRMED',
                            },
                            {
                                status: 'PENDING',
                                expiresAt: {
                                    gt: lockedNow,
                                },
                            },
                        ],
                    },
                });

            if (conflictingReservation) {
                throw new BadRequestException(
                    'Room is already reserved for the selected time',
                );
            }

            /**
             * Check overlap against administrative room blocks.
             */
            const conflictingBlock =
                await tx.roomBlock.findFirst({
                    where: {
                        roomId: dto.roomId,
                        startTime: {
                            lt: endTime,
                        },
                        endTime: {
                            gt: startTime,
                        },
                    },
                });

            if (conflictingBlock) {
                throw new BadRequestException(
                    'Room is blocked for the selected time',
                );
            }

            const durationInHours =
                (endTime.getTime() -
                    startTime.getTime()) /
                (1000 * 60 * 60);

            const totalPrice =
                Number(room.pricePerHour) *
                durationInHours;

            const expiresAt = new Date(
                lockedNow.getTime() +
                PENDING_HOLD_MINUTES *
                60 *
                1000,
            );

            return tx.reservation.create({
                data: {
                    doctorId: doctor.id,
                    roomId: room.id,
                    startTime,
                    endTime,
                    totalPrice,
                    status: 'PENDING',
                    expiresAt,
                },
            });
        });
    }

    async findAll(
        userId: string,
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
            reservation.status ===
            'CANCELLED'
        ) {
            throw new BadRequestException(
                'Reservation is already cancelled',
            );
        }

        if (
            reservation.status ===
            'EXPIRED'
        ) {
            throw new BadRequestException(
                'Reservation is already expired',
            );
        }

        if (
            reservation.status ===
            'COMPLETED'
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