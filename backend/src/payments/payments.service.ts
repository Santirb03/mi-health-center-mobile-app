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
        const reservation =
            await this.prisma.reservation.findUnique({
                where: {
                    id: reservationId,
                },
            });

        if (!reservation) {
            throw new NotFoundException(
                'Reservation not found',
            );
        }

        if (reservation.status !== 'PENDING') {
            throw new BadRequestException(
                'Only pending reservations can be paid',
            );
        }

        // Si ya existe un Payment para esta reserva,
        // reutilizamos el PaymentIntent existente.
        const existingPayment =
            await this.prisma.payment.findUnique({
                where: {
                    reservationId: reservation.id,
                },
            });

        if (existingPayment) {
            if (existingPayment.status === 'PAID') {
                throw new BadRequestException(
                    'Reservation has already been paid',
                );
            }

            if (existingPayment.transactionId) {
                const existingPaymentIntent =
                    await this.stripe.paymentIntents.retrieve(
                        existingPayment.transactionId,
                    );

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

        // La reservationId funciona como idempotency key.
        // Si la misma petición llega nuevamente a Stripe,
        // Stripe devuelve el mismo PaymentIntent.
        const paymentIntent =
            await this.stripe.paymentIntents.create(
                {
                    amount: amountInCents,
                    currency: 'mxn',
                    metadata: {
                        reservationId: reservation.id,
                    },
                },
                {
                    idempotencyKey: `reservation-${reservation.id}`,
                },
            );

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

    async handleStripeWebhook(event: Stripe.Event) {
        return this.prisma.$transaction(async (tx) => {
            // Intentamos registrar el evento.
            //
            // Stripe puede mandar el mismo webhook más de una vez.
            // Como StripeWebhookEvent.id es PRIMARY KEY,
            // un evento repetido producirá P2002.
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

            console.log(
                'Stripe event:',
                event.type,
            );

            if (event.type === 'payment_intent.succeeded') {
                const paymentIntent =
                    event.data.object as Stripe.PaymentIntent;

                const payment =
                    await tx.payment.findUnique({
                        where: {
                            transactionId:
                                paymentIntent.id,
                        },
                    });

                if (!payment) {
                    throw new NotFoundException(
                        'Payment not found',
                    );
                }

                // Verificamos que el monto que Stripe confirmó
                // sea exactamente el monto de nuestra reserva.
                const expectedAmount = Math.round(
                    Number(payment.amount) * 100,
                );

                if (
                    paymentIntent.amount !==
                    expectedAmount
                ) {
                    throw new BadRequestException(
                        'Payment amount does not match Stripe amount',
                    );
                }

                // Si ya estaba pagado, no hacemos nada.
                if (payment.status === 'PAID') {
                    return {
                        duplicate: false,
                        alreadyProcessed: true,
                    };
                }

                // Payment y Reservation se actualizan
                // dentro de la misma transacción.
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

            return {
                duplicate: false,
                processed: true,
            };
        });
    }
}