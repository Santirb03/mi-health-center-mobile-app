import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';

import { RoomsService } from './rooms.service';

import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('rooms')
export class RoomsController {
    constructor(
        private readonly roomsService: RoomsService,
    ) { }

    @Get()
    findAll() {
        return this.roomsService.findAll();
    }

    @Get(':id')
    findOne(
        @Param('id') id: string,
    ) {
        return this.roomsService.findOne(id);
    }

    @Post()
    @UseGuards(
        JwtAuthGuard,
        RolesGuard,
    )
    @Roles('ADMIN')
    create(
        @Body() dto: CreateRoomDto,
    ) {
        return this.roomsService.create(dto);
    }

    @Patch(':id')
    @UseGuards(
        JwtAuthGuard,
        RolesGuard,
    )
    @Roles('ADMIN')
    update(
        @Param('id') id: string,
        @Body() dto: UpdateRoomDto,
    ) {
        return this.roomsService.update(
            id,
            dto,
        );
    }

    @Delete(':id')
    @UseGuards(
        JwtAuthGuard,
        RolesGuard,
    )
    @Roles('ADMIN')
    remove(
        @Param('id') id: string,
    ) {
        return this.roomsService.remove(id);
    }
}