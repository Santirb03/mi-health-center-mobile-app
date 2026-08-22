import {
    Controller,
    Param,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { Request } from 'express';

import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

interface AuthenticatedRequest extends Request {
    user: {
        userId: string;
        email: string;
        role: string;
    };
}

@Controller('payments')
export class PaymentsController {
    constructor(
        private readonly paymentsService: PaymentsService,
    ) { }

    @Post('reservations/:reservationId')
    @UseGuards(JwtAuthGuard)
    createPaymentIntent(
        @Req() req: AuthenticatedRequest,
        @Param('reservationId') reservationId: string,
    ) {
        return this.paymentsService.createPaymentIntent(
            reservationId,
        );
    }
}