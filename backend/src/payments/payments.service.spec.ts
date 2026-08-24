import {
    BadRequestException,
    NotFoundException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
    let service: PaymentsService;

    const mockConfigService = {
        get: jest.fn().mockReturnValue('test-stripe-secret'),
    };

    const mockStripeWebhookEventCreate = jest.fn();
    const mockPaymentFindUnique = jest.fn();
    const mockPaymentUpdate = jest.fn();
    const mockReservationUpdate = jest.fn();

    const mockTx = {
        stripeWebhookEvent: {
            create: mockStripeWebhookEventCreate,
        },
        payment: {
            findUnique: mockPaymentFindUnique,
            update: mockPaymentUpdate,
        },
        reservation: {
            update: mockReservationUpdate,
        },
    };

    const mockPrisma = {
        $transaction: jest.fn(
            async (
                callback: (tx: typeof mockTx) => Promise<unknown>,
            ) => callback(mockTx),
        ),
    };

    beforeEach(() => {
        jest.clearAllMocks();

        service = new PaymentsService(
            mockConfigService as any,
            mockPrisma as any,
        );
    });

    describe('handleStripeWebhook', () => {
        it('should mark payment as PAID and reservation as CONFIRMED', async () => {
            mockStripeWebhookEventCreate.mockResolvedValue({
                id: 'evt_test_123',
                type: 'payment_intent.succeeded',
            });

            mockPaymentFindUnique.mockResolvedValue({
                id: 'payment-123',
                reservationId: 'reservation-123',
                amount: 350,
                status: 'PENDING',
                transactionId: 'pi_test_123',
            });

            mockPaymentUpdate.mockResolvedValue({
                id: 'payment-123',
                status: 'PAID',
            });

            mockReservationUpdate.mockResolvedValue({
                id: 'reservation-123',
                status: 'CONFIRMED',
            });

            const event = {
                id: 'evt_test_123',
                type: 'payment_intent.succeeded',
                data: {
                    object: {
                        id: 'pi_test_123',
                        amount: 35000,
                    },
                },
            } as Stripe.Event;

            const result = await service.handleStripeWebhook(event);

            expect(mockStripeWebhookEventCreate).toHaveBeenCalledWith({
                data: {
                    id: 'evt_test_123',
                    type: 'payment_intent.succeeded',
                },
            });

            expect(mockPaymentFindUnique).toHaveBeenCalledWith({
                where: {
                    transactionId: 'pi_test_123',
                },
            });

            expect(mockPaymentUpdate).toHaveBeenCalledWith({
                where: {
                    id: 'payment-123',
                },
                data: {
                    status: 'PAID',
                },
            });

            expect(mockReservationUpdate).toHaveBeenCalledWith({
                where: {
                    id: 'reservation-123',
                },
                data: {
                    status: 'CONFIRMED',
                },
            });

            expect(result).toEqual({
                duplicate: false,
                processed: true,
            });
        });

        it('should reject the webhook if the payment amount does not match', async () => {
            mockStripeWebhookEventCreate.mockResolvedValue({
                id: 'evt_test_amount',
                type: 'payment_intent.succeeded',
            });

            mockPaymentFindUnique.mockResolvedValue({
                id: 'payment-123',
                reservationId: 'reservation-123',
                amount: 350,
                status: 'PENDING',
                transactionId: 'pi_test_amount',
            });

            const event = {
                id: 'evt_test_amount',
                type: 'payment_intent.succeeded',
                data: {
                    object: {
                        id: 'pi_test_amount',
                        amount: 40000,
                    },
                },
            } as Stripe.Event;

            await expect(
                service.handleStripeWebhook(event),
            ).rejects.toThrow(
                new BadRequestException(
                    'Payment amount does not match Stripe amount',
                ),
            );

            expect(mockPaymentUpdate).not.toHaveBeenCalled();
            expect(mockReservationUpdate).not.toHaveBeenCalled();
        });

        it('should throw if the payment does not exist', async () => {
            mockStripeWebhookEventCreate.mockResolvedValue({
                id: 'evt_test_missing_payment',
                type: 'payment_intent.succeeded',
            });

            mockPaymentFindUnique.mockResolvedValue(null);

            const event = {
                id: 'evt_test_missing_payment',
                type: 'payment_intent.succeeded',
                data: {
                    object: {
                        id: 'pi_missing',
                        amount: 35000,
                    },
                },
            } as Stripe.Event;

            await expect(
                service.handleStripeWebhook(event),
            ).rejects.toThrow(
                new NotFoundException('Payment not found'),
            );

            expect(mockPaymentUpdate).not.toHaveBeenCalled();
            expect(mockReservationUpdate).not.toHaveBeenCalled();
        });

        it('should ignore a duplicate webhook event', async () => {
            const prismaError = Object.assign(
                new Error('Unique constraint failed'),
                {
                    code: 'P2002',
                },
            );

            mockStripeWebhookEventCreate.mockRejectedValue(
                prismaError,
            );

            const event = {
                id: 'evt_duplicate',
                type: 'payment_intent.succeeded',
                data: {
                    object: {
                        id: 'pi_duplicate',
                        amount: 35000,
                    },
                },
            } as Stripe.Event;

            const result =
                await service.handleStripeWebhook(event);

            expect(result).toEqual({
                duplicate: true,
            });

            expect(mockPaymentFindUnique).not.toHaveBeenCalled();
            expect(mockPaymentUpdate).not.toHaveBeenCalled();
            expect(mockReservationUpdate).not.toHaveBeenCalled();
        });
    });
});