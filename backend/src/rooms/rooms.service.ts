import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { CreateRoomBlockDto } from './dto/create-room-block.dto';

const OPENING_HOUR = 8;
const CLOSING_HOUR = 21;

const BUSINESS_TIMEZONE = 'America/Mexico_City';
const BUSINESS_TIMEZONE_OFFSET = '-06:00';

export interface AvailabilitySlot {
    startTime: string;
    endTime: string;
    startDateTime: string;
    endDateTime: string;
    available: boolean;
    blocked: boolean;
    blockReason: string | null;
}

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

        const dayStart =
            this.createBusinessDate(
                date,
                OPENING_HOUR,
            );

        const dayEnd =
            this.createBusinessDate(
                date,
                CLOSING_HOUR,
            );

        const reservations =
            await this.prisma.reservation.findMany({
                where: {
                    roomId: id,
                    startTime: {
                        lt: dayEnd,
                    },
                    endTime: {
                        gt: dayStart,
                    },
                    OR: [
                        {
                            status: 'CONFIRMED',
                        },
                        {
                            status: 'PENDING',
                            expiresAt: {
                                gt: new Date(),
                            },
                        },
                    ],
                },
                select: {
                    startTime: true,
                    endTime: true,
                },
            });

        const blocks =
            await this.prisma.roomBlock.findMany({
                where: {
                    roomId: id,
                    startTime: {
                        lt: dayEnd,
                    },
                    endTime: {
                        gt: dayStart,
                    },
                },
                select: {
                    id: true,
                    startTime: true,
                    endTime: true,
                    reason: true,
                },
            });

        const slots: AvailabilitySlot[] = [];

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

            const occupiedByReservation =
                reservations.some(
                    (reservation) =>
                        reservation.startTime <
                        slotEnd &&
                        reservation.endTime >
                        slotStart,
                );

            const matchingBlock =
                blocks.find(
                    (block) =>
                        block.startTime <
                        slotEnd &&
                        block.endTime >
                        slotStart,
                );

            slots.push({
                startTime:
                    this.formatHour(hour),

                endTime:
                    this.formatHour(
                        hour + 1,
                    ),

                startDateTime:
                    slotStart.toISOString(),

                endDateTime:
                    slotEnd.toISOString(),

                available:
                    !occupiedByReservation &&
                    !matchingBlock,

                blocked:
                    Boolean(matchingBlock),

                blockReason:
                    matchingBlock?.reason ??
                    null,
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

    async create(
        dto: CreateRoomDto,
    ) {
        return this.prisma.room.create({
            data: {
                name: dto.name,
                description:
                    dto.description,
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

    async createBlock(
        roomId: string,
        dto: CreateRoomBlockDto,
    ) {
        const room =
            await this.findOne(roomId);

        if (!room.active) {
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
                'Room blocks must start and end on a full hour',
            );
        }

        return this.prisma.$transaction(async (tx) => {
            /**
             * Reservation creation uses the same transaction-scoped
             * PostgreSQL advisory lock for this room.
             *
             * This prevents a reservation and an administrative block
             * from both winning the same time range without depending
             * on the physical database table name.
             */
            await tx.$executeRaw`
                SELECT pg_advisory_xact_lock(hashtext(${roomId}))
            `;

            const conflictingBlock =
                await tx.roomBlock.findFirst({
                    where: {
                        roomId,
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
                    'Room already has a block for the selected time',
                );
            }

            const conflictingReservation =
                await tx.reservation.findFirst({
                    where: {
                        roomId,
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
                                    gt: new Date(),
                                },
                            },
                        ],
                    },
                });

            if (conflictingReservation) {
                throw new BadRequestException(
                    'Room already has a reservation for the selected time',
                );
            }

            return tx.roomBlock.create({
                data: {
                    roomId,
                    startTime,
                    endTime,
                    reason: dto.reason,
                },
            });
        });
    }

    async findBlocks(
        roomId: string,
    ) {
        await this.findOne(roomId);

        return this.prisma.roomBlock.findMany({
            where: {
                roomId,
            },
            orderBy: {
                startTime: 'asc',
            },
        });
    }

    async removeBlock(
        roomId: string,
        blockId: string,
    ) {
        await this.findOne(roomId);

        const block =
            await this.prisma.roomBlock.findFirst({
                where: {
                    id: blockId,
                    roomId,
                },
            });

        if (!block) {
            throw new NotFoundException(
                'Room block not found',
            );
        }

        return this.prisma.roomBlock.delete({
            where: {
                id: blockId,
            },
        });
    }

    private validateDate(
        date: string,
    ) {
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
