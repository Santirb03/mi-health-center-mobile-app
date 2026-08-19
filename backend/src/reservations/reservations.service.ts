import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReservationDto } from './dto/create-reservation.dto';

@Injectable()
export class ReservationsService {
    constructor(private readonly prisma: PrismaService) { }

    async create(userId: string, dto: CreateReservationDto) {
        const doctor = await this.prisma.doctorProfile.findUnique({
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

        // Reservations must start and end on a full hour.
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

        const conflictingReservation =
            await this.prisma.reservation.findFirst({
                where: {
                    roomId: dto.roomId,
                    status: {
                        in: ['PENDING', 'CONFIRMED'],
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
            (endTime.getTime() - startTime.getTime()) /
            (1000 * 60 * 60);

        const totalPrice =
            Number(room.pricePerHour) * durationInHours;

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
        const doctor = await this.prisma.doctorProfile.findUnique({
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
        const doctor = await this.prisma.doctorProfile.findUnique({
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
        const doctor = await this.prisma.doctorProfile.findUnique({
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

        if (reservation.status === 'CANCELLED') {
            throw new BadRequestException(
                'Reservation is already cancelled',
            );
        }

        if (reservation.status === 'COMPLETED') {
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