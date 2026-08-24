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
        const stripeSecret = this.configService.get<string>(
            'STRIPE_SECRET_KEY',
        );

        if (!stripeSecret) {
            throw new Error('STRIPE_SECRET_KEY is not configured');
        }

        this.stripe = new Stripe(stripeSecret);
    }

    async createPaymentIntent(
        userId: string,
        reservationId: string,
    ) {
        const doctor = await this.prisma.doctorProfile.findUnique({
            where: {
                userId,
            },
        });

        if (!doctor) {
            throw new NotFoundException('Doctor profile not found');
        }

        const reservation =
            await this.prisma.reservation.findFirst({
                where: {
                    id: reservationId,
                    doctorId: doctor.id,
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

        const existingPayment =
            await this.prisma.payment.findUnique({
                where: {
                    reservationId: reservation.id,
                },
            });

        if (existingPayment?.status === 'PAID') {
            throw new BadRequestException(
                'Reservation has already been paid',
            );
        }

        if (existingPayment?.transactionId) {
            const existingPaymentIntent =
                await this.stripe.paymentIntents.retrieve(
                    existingPayment.transactionId,
                );

            if (
                existingPaymentIntent.status !== 'canceled' &&
                existingPaymentIntent.client_secret
            ) {
                return {
                    clientSecret:
                        existingPaymentIntent.client_secret,
                    paymentIntentId:
                        existingPaymentIntent.id,
                };
            }
        }

        const amountInCents = Math.round(
            Number(reservation.totalPrice) * 100,
        );

        if (amountInCents <= 0) {
            throw new BadRequestException(
                'Payment amount must be greater than zero',
            );
        }

        const paymentIntent =
            await this.stripe.paymentIntents.create(
                {
                    amount: amountInCents,
                    currency: 'mxn',
                    metadata: {
                        reservationId: reservation.id,
                        doctorId: doctor.id,
                    },
                },
                {
                    idempotencyKey:
                        `reservation-${reservation.id}`,
                },
            );

        if (existingPayment) {
            await this.prisma.payment.update({
                where: {
                    id: existingPayment.id,
                },
                data: {
                    amount: reservation.totalPrice,
                    status: 'PENDING',
                    provider: 'stripe',
                    transactionId: paymentIntent.id,
                },
            });
        } else {
            await this.prisma.payment.create({
                data: {
                    reservationId: reservation.id,
                    amount: reservation.totalPrice,
                    status: 'PENDING',
                    provider: 'stripe',
                    transactionId: paymentIntent.id,
                },
            });
        }

        return {
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
        };
    }

    async handleStripeWebhook(event: Stripe.Event) {
        return this.prisma.$transaction(async (tx) => {
            try {
                await tx.stripeWebhookEvent.create({
                    data: {
                        id: event.id,
                        type: event.type,
                    },
                });
            } catch (error) {
                if (
                    error instanceof Error &&
                    'code' in error &&
                    error.code === 'P2002'
                ) {
                    console.log(
                        'Webhook already processed:',
                        event.id,
                    );

                    return {
                        duplicate: true,
                    };
                }

                throw error;
            }

            if (event.type === 'payment_intent.succeeded') {
                const paymentIntent =
                    event.data.object as Stripe.PaymentIntent;

                const payment =
                    await tx.payment.findUnique({
                        where: {
                            transactionId: paymentIntent.id,
                        },
                    });

                if (!payment) {
                    throw new NotFoundException(
                        'Payment not found',
                    );
                }

                const expectedAmount = Math.round(
                    Number(payment.amount) * 100,
                );

                if (
                    paymentIntent.amount !== expectedAmount
                ) {
                    throw new BadRequestException(
                        'Payment amount does not match Stripe amount',
                    );
                }

                if (payment.status === 'PAID') {
                    return {
                        duplicate: false,
                        alreadyProcessed: true,
                    };
                }

                await tx.payment.update({
                    where: {
                        id: payment.id,
                    },
                    data: {
                        status: 'PAID',
                    },
                });

                await tx.reservation.update({
                    where: {
                        id: payment.reservationId,
                    },
                    data: {
                        status: 'CONFIRMED',
                    },
                });
            }

            if (
                event.type ===
                'payment_intent.payment_failed'
            ) {
                const paymentIntent =
                    event.data.object as Stripe.PaymentIntent;

                const payment =
                    await tx.payment.findUnique({
                        where: {
                            transactionId: paymentIntent.id,
                        },
                    });

                if (payment) {
                    await tx.payment.update({
                        where: {
                            id: payment.id,
                        },
                        data: {
                            status: 'FAILED',
                        },
                    });
                }
            }

            if (
                event.type ===
                'payment_intent.canceled'
            ) {
                const paymentIntent =
                    event.data.object as Stripe.PaymentIntent;

                const payment =
                    await tx.payment.findUnique({
                        where: {
                            transactionId: paymentIntent.id,
                        },
                    });

                if (payment) {
                    await tx.payment.update({
                        where: {
                            id: payment.id,
                        },
                        data: {
                            status: 'FAILED',
                        },
                    });
                }
            }

            return {
                duplicate: false,
                processed: true,
            };
        });
    }
}