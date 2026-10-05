import {
    Controller,
    Get,
    Query,
    Param,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { Request } from 'express';

import { PaymentsService } from './payments.service';
import { PaymentHistoryService } from './payment-history.service';
import { PaymentHistoryDto } from './dto/payment-history.dto';
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
        private readonly paymentHistoryService: PaymentHistoryService,
    ) { }

    @Get('history')
    @UseGuards(JwtAuthGuard)
    history(@Req() req: AuthenticatedRequest, @Query() query: PaymentHistoryDto) {
        return this.paymentHistoryService.history(req.user.userId, query);
    }

    @Post('reservations/:reservationId')
    @UseGuards(JwtAuthGuard)
    createPaymentIntent(
        @Req() req: AuthenticatedRequest,
        @Param('reservationId') reservationId: string,
    ) {
        return this.paymentsService.createPaymentIntent(
            req.user.userId,
            reservationId,
        );
    }
}
