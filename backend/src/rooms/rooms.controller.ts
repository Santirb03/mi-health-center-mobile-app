import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';

@Controller('rooms')
export class RoomsController {
    constructor(private readonly roomsService: RoomsService) { }

    @Get()
    findAll() {
        return this.roomsService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.roomsService.findOne(id);
    }

    @Post()
    create(@Body() dto: CreateRoomDto) {
        return this.roomsService.create(dto);
    }
}