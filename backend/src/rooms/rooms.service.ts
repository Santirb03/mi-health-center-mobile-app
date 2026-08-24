import {
    Injectable,
    NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';

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

    async create(dto: CreateRoomDto) {
        return this.prisma.room.create({
            data: {
                name: dto.name,
                description: dto.description,
                pricePerHour: dto.pricePerHour,
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
}