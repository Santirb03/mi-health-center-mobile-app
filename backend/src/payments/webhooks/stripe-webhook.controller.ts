import {
    BadRequestException,
    Controller,
    Headers,
    Post,
    Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { Request } from 'express';
import { PaymentsService } from '../payments.service';

@Controller('payments/webhook')
export class StripeWebhookController {
    private readonly stripe: Stripe;

    constructor(
        private readonly configService: ConfigService,
        private readonly paymentsService: PaymentsService,
    ) {
        this.stripe = new Stripe(
            this.configService.get<string>('STRIPE_SECRET_KEY')!,
        );
    }

    @Post()
    async handleWebhook(
        @Req() request: Request & { rawBody?: Buffer },
        @Headers('stripe-signature') signature: string,
    ) {
        if (!signature) {
            throw new BadRequestException(
                'Missing Stripe signature',
            );
        }

        if (!request.rawBody) {
            throw new BadRequestException(
                'Missing raw request body',
            );
        }

        let event: Stripe.Event;

        try {
            event = this.stripe.webhooks.constructEvent(
                request.rawBody,
                signature,
                this.configService.get<string>(
                    'STRIPE_WEBHOOK_SECRET',
                )!,
            );
        } catch {
            throw new BadRequestException(
                'Invalid Stripe webhook signature',
            );
        }

        await this.paymentsService.handleStripeWebhook(event);

        return {
            received: true,
        };
    }
}