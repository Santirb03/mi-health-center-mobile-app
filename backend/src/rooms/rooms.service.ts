import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';

const OPENING_HOUR = 8;
const CLOSING_HOUR = 21;

const BUSINESS_TIMEZONE = 'America/Mexico_City';
const BUSINESS_TIMEZONE_OFFSET = '-06:00';

@Injectable()
export class RoomsService {
    constructor(
        private readonly prisma: PrismaService,
    ) { }

    async findAll() {
        return this.prisma.room.findMany({
            where: {
                active: true,
            },
            orderBy: {
                name: 'asc',
            },
        });
    }

    async findOne(id: string) {
        const room =
            await this.prisma.room.findUnique({
                where: {
                    id,
                },
            });

        if (!room) {
            throw new NotFoundException(
                'Room not found',
            );
        }

        return room;
    }

    async getAvailability(
        id: string,
        date: string,
    ) {
        this.validateDate(date);

        const room = await this.findOne(id);

        if (!room.active) {
            throw new NotFoundException(
                'Room not found or inactive',
            );
        }

        const dayStart = this.createBusinessDate(
            date,
            OPENING_HOUR,
        );

        const dayEnd = this.createBusinessDate(
            date,
            CLOSING_HOUR,
        );

        const reservations =
            await this.prisma.reservation.findMany({
                where: {
                    roomId: id,
                    status: {
                        in: [
                            'PENDING',
                            'CONFIRMED',
                        ],
                    },
                    startTime: {
                        lt: dayEnd,
                    },
                    endTime: {
                        gt: dayStart,
                    },
                },
                select: {
                    startTime: true,
                    endTime: true,
                },
            });

        const slots = [];

        for (
            let hour = OPENING_HOUR;
            hour < CLOSING_HOUR;
            hour++
        ) {
            const slotStart =
                this.createBusinessDate(
                    date,
                    hour,
                );

            const slotEnd =
                this.createBusinessDate(
                    date,
                    hour + 1,
                );

            const occupied =
                reservations.some(
                    (reservation) =>
                        reservation.startTime <
                        slotEnd &&
                        reservation.endTime >
                        slotStart,
                );

            slots.push({
                startTime:
                    this.formatHour(hour),
                endTime:
                    this.formatHour(hour + 1),
                startDateTime:
                    slotStart.toISOString(),
                endDateTime:
                    slotEnd.toISOString(),
                available: !occupied,
            });
        }

        return {
            roomId: room.id,
            roomName: room.name,
            date,
            timeZone: BUSINESS_TIMEZONE,
            opensAt: '08:00',
            closesAt: '21:00',
            slots,
        };
    }

    async create(dto: CreateRoomDto) {
        return this.prisma.room.create({
            data: {
                name: dto.name,
                description: dto.description,
                pricePerHour:
                    dto.pricePerHour,
            },
        });
    }

    async update(
        id: string,
        dto: UpdateRoomDto,
    ) {
        await this.findOne(id);

        return this.prisma.room.update({
            where: {
                id,
            },
            data: dto,
        });
    }

    async remove(id: string) {
        await this.findOne(id);

        return this.prisma.room.update({
            where: {
                id,
            },
            data: {
                active: false,
            },
        });
    }

    private validateDate(date: string) {
        if (
            !date ||
            !/^\d{4}-\d{2}-\d{2}$/.test(
                date,
            )
        ) {
            throw new BadRequestException(
                'Date must use YYYY-MM-DD format',
            );
        }

        const [
            year,
            month,
            day,
        ] = date
            .split('-')
            .map(Number);

        const parsedDate =
            new Date(
                Date.UTC(
                    year,
                    month - 1,
                    day,
                ),
            );

        const valid =
            parsedDate.getUTCFullYear() ===
            year &&
            parsedDate.getUTCMonth() ===
            month - 1 &&
            parsedDate.getUTCDate() ===
            day;

        if (!valid) {
            throw new BadRequestException(
                'Invalid date',
            );
        }
    }

    private createBusinessDate(
        date: string,
        hour: number,
    ) {
        const formattedHour =
            hour
                .toString()
                .padStart(2, '0');

        return new Date(
            `${date}T${formattedHour}:00:00${BUSINESS_TIMEZONE_OFFSET}`,
        );
    }

    private formatHour(
        hour: number,
    ) {
        return `${hour
            .toString()
            .padStart(2, '0')}:00`;
    }
}