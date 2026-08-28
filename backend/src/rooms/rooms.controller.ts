import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';

import { RoomsService } from './rooms.service';

import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { CreateRoomBlockDto } from './dto/create-room-block.dto';

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

    @Get(':id/availability')
    getAvailability(
        @Param('id') id: string,
        @Query('date') date: string,
    ) {
        return this.roomsService.getAvailability(
            id,
            date,
        );
    }

    @Get(':id/blocks')
    @UseGuards(
        JwtAuthGuard,
        RolesGuard,
    )
    @Roles('ADMIN')
    findBlocks(
        @Param('id') id: string,
    ) {
        return this.roomsService.findBlocks(
            id,
        );
    }

    @Post(':id/blocks')
    @UseGuards(
        JwtAuthGuard,
        RolesGuard,
    )
    @Roles('ADMIN')
    createBlock(
        @Param('id') id: string,
        @Body() dto: CreateRoomBlockDto,
    ) {
        return this.roomsService.createBlock(
            id,
            dto,
        );
    }

    @Delete(':id/blocks/:blockId')
    @UseGuards(
        JwtAuthGuard,
        RolesGuard,
    )
    @Roles('ADMIN')
    removeBlock(
        @Param('id') id: string,
        @Param('blockId') blockId: string,
    ) {
        return this.roomsService.removeBlock(
            id,
            blockId,
        );
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