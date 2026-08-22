import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentsService {
    private readonly stripe: Stripe;

    constructor(
        private readonly configService: ConfigService,
        private readonly prisma: PrismaService,
    ) {
        this.stripe = new Stripe(
            this.configService.get<string>('STRIPE_SECRET_KEY')!,
        );
    }
    async createPaymentIntent(reservationId: string) {
        const reservation = await this.prisma.reservation.findUnique({
            where: {
                id: reservationId,
            },
        });

        if (!reservation) {
            throw new NotFoundException('Reservation not found');
        }

        if (reservation.status !== 'PENDING') {
            throw new BadRequestException(
                'Only pending reservations can be paid',
            );
        }

        const amountInCents = Math.round(
            Number(reservation.totalPrice) * 100,
        );

        const paymentIntent = await this.stripe.paymentIntents.create({
            amount: amountInCents,
            currency: 'mxn',
            metadata: {
                reservationId: reservation.id,
            },
        });

        await this.prisma.payment.create({
            data: {
                reservationId: reservation.id,
                amount: reservation.totalPrice,
                status: 'PENDING',
                provider: 'stripe',
                transactionId: paymentIntent.id,
            },
        });

        return {
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
        };
    }

    async handlePaymentIntentSucceeded(
        paymentIntent: Stripe.PaymentIntent,
    ) {
        const payment = await this.prisma.payment.findUnique({
            where: {
                transactionId: paymentIntent.id,
            },
        });

        if (!payment) {
            throw new NotFoundException(
                'Payment not found',
            );
        }

        if (payment.status === 'PAID') {
            return payment;
        }

        const updatedPayment = await this.prisma.payment.update({
            where: {
                id: payment.id,
            },
            data: {
                status: 'PAID',
            },
        });

        await this.prisma.reservation.update({
            where: {
                id: payment.reservationId,
            },
            data: {
                status: 'CONFIRMED',
            },
        });

        return updatedPayment;
    }
}