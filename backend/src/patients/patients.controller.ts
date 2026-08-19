import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { Request } from 'express';

import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

interface AuthenticatedRequest extends Request {
    user: {
        userId: string;
        email: string;
        role: string;
    };
}

@Controller('patients')
export class PatientsController {
    constructor(
        private readonly patientsService: PatientsService,
    ) { }

    @Post()
    @UseGuards(JwtAuthGuard)
    create(
        @Req() req: AuthenticatedRequest,
        @Body() dto: CreatePatientDto,
    ) {
        return this.patientsService.create(
            req.user.userId,
            dto,
        );
    }

    @Get()
    @UseGuards(JwtAuthGuard)
    findAll(
        @Req() req: AuthenticatedRequest,
    ) {
        return this.patientsService.findAll(
            req.user.userId,
        );
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    findOne(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string,
    ) {
        return this.patientsService.findOne(
            req.user.userId,
            id,
        );
    }
}