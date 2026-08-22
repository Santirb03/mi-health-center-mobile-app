import { Module } from '@nestjs/common';

import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeWebhookController } from './webhooks/stripe-webhook.controller';

@Module({
    controllers: [
        PaymentsController,
        StripeWebhookController,
    ],
    providers: [PaymentsService],
    exports: [PaymentsService],
})
export class PaymentsModule { }