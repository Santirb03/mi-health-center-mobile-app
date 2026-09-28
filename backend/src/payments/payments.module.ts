import { Module } from '@nestjs/common';
import { RefundWorker } from './refund-worker';

import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeWebhookController } from './webhooks/stripe-webhook.controller';

@Module({
    controllers: [
        PaymentsController,
        StripeWebhookController,
    ],
    providers: [PaymentsService, RefundWorker],
    exports: [PaymentsService],
})
export class PaymentsModule { }
