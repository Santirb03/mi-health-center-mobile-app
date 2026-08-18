import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoomDto } from './dto/create-room.dto';

@Injectable()
export class RoomsService {
    constructor(private readonly prisma: PrismaService) { }

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
        return this.prisma.room.findUnique({
            where: {
                id,
            },
        });
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
}