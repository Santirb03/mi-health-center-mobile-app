import {
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Post,
    Req,
    Query,
    UseGuards,
} from '@nestjs/common';
import { Request } from 'express';

import { ReservationsService } from './reservations.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReservationPageDto } from './dto/reservation-page.dto';

interface AuthenticatedRequest extends Request {
    user: {
        userId: string;
        email: string;
        role: string;
    };
}

@Controller('reservations')
export class ReservationsController {
    constructor(
        private readonly reservationsService: ReservationsService,
    ) { }

    @Post()
    @UseGuards(JwtAuthGuard)
    create(
        @Req() req: AuthenticatedRequest,
        @Body() dto: CreateReservationDto,
    ) {
        return this.reservationsService.create(
            req.user.userId,
            dto,
        );
    }

    @Get()
    @UseGuards(JwtAuthGuard)
    findAll(@Req() req: AuthenticatedRequest) {
        return this.reservationsService.findAll(
            req.user.userId,
        );
    }

    @Get('page')
    @UseGuards(JwtAuthGuard)
    page(@Req() req: AuthenticatedRequest, @Query() query: ReservationPageDto) {
        return this.reservationsService.page(req.user.userId, query);
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    findOne(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string,
    ) {
        return this.reservationsService.findOne(
            req.user.userId,
            id,
        );
    }

    @Patch(':id/cancel')
    @UseGuards(JwtAuthGuard)
    cancel(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string,
    ) {
        return this.reservationsService.cancel(
            req.user.userId,
            id,
        );
    }
}
