import {
    BadRequestException,
    NotFoundException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
    let service: PaymentsService;

    const NOW = new Date('2026-08-28T18:00:00.000Z');

    const mockConfigService = {
        get: jest.fn().mockReturnValue('test-stripe-secret'),
    };

    const mockDoctorFindUnique = jest.fn();
    const mockReservationFindFirst = jest.fn();
    const mockReservationFindUnique = jest.fn();
    const mockReservationUpdate = jest.fn();

    const mockPaymentFindUnique = jest.fn();
    const mockPaymentCreate = jest.fn();
    const mockPaymentUpdate = jest.fn();

    const mockStripeWebhookEventCreate = jest.fn();

    const mockTxReservationFindUnique = jest.fn();
    const mockTxReservationFindFirst = jest.fn();
    const mockTxReservationUpdate = jest.fn();

    const mockTxPaymentFindUnique = jest.fn();
    const mockTxPaymentUpdate = jest.fn();

    const mockTx = {
        stripeWebhookEvent: {
            create: mockStripeWebhookEventCreate,
        },
        payment: {
            findUnique: mockTxPaymentFindUnique,
            update: mockTxPaymentUpdate,
        },
        reservation: {
            findUnique: mockTxReservationFindUnique,
            findFirst: mockTxReservationFindFirst,
            update: mockTxReservationUpdate,
        },
    };

    const mockPrisma = {
        doctorProfile: {
            findUnique: mockDoctorFindUnique,
        },
        reservation: {
            findFirst: mockReservationFindFirst,
            findUnique: mockReservationFindUnique,
            update: mockReservationUpdate,
        },
        payment: {
            findUnique: mockPaymentFindUnique,
            create: mockPaymentCreate,
            update: mockPaymentUpdate,
        },
        $transaction: jest.fn(
            async (
                callback: (tx: typeof mockTx) => Promise<unknown>,
            ) => callback(mockTx),
        ),
    };

    const mockStripePaymentIntentsCreate = jest.fn();
    const mockStripePaymentIntentsRetrieve = jest.fn();
    const mockStripeRefundsCreate = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();

        jest.useFakeTimers();
        jest.setSystemTime(NOW);

        service = new PaymentsService(
            mockConfigService as any,
            mockPrisma as any,
        );

        (service as any).stripe = {
            paymentIntents: {
                create: mockStripePaymentIntentsCreate,
                retrieve: mockStripePaymentIntentsRetrieve,
            },
            refunds: {
                create: mockStripeRefundsCreate,
            },
        };
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('createPaymentIntent', () => {
        it('should create a payment intent for an unexpired pending reservation', async () => {
            const expiresAt = new Date(
                '2026-08-28T18:08:00.000Z',
            );

            mockDoctorFindUnique.mockResolvedValue({
                id: 'doctor-123',
                userId: 'user-123',
            });

            mockReservationFindFirst.mockResolvedValue({
                id: 'reservation-123',
                doctorId: 'doctor-123',
                roomId: 'room-123',
                totalPrice: 350,
                status: 'PENDING',
                expiresAt,
            });

            mockPaymentFindUnique.mockResolvedValue(null);

            mockStripePaymentIntentsCreate.mockResolvedValue({
                id: 'pi_test_123',
                client_secret: 'secret_123',
            });

            mockPaymentCreate.mockResolvedValue({
                id: 'payment-123',
            });

            const result =
                await service.createPaymentIntent(
                    'user-123',
                    'reservation-123',
                );

            expect(mockDoctorFindUnique).toHaveBeenCalledWith({
                where: {
                    userId: 'user-123',
                },
            });

            expect(
                mockReservationFindFirst,
            ).toHaveBeenCalledWith({
                where: {
                    id: 'reservation-123',
                    doctorId: 'doctor-123',
                },
            });

            expect(
                mockStripePaymentIntentsCreate,
            ).toHaveBeenCalledWith(
                {
                    amount: 35000,
                    currency: 'mxn',
                    metadata: {
                        reservationId: 'reservation-123',
                        doctorId: 'doctor-123',
                    },
                },
                {
                    idempotencyKey:
                        'reservation-reservation-123',
                },
            );

            expect(mockPaymentCreate).toHaveBeenCalledWith({
                data: {
                    reservationId: 'reservation-123',
                    amount: 350,
                    status: 'PENDING',
                    provider: 'stripe',
                    transactionId: 'pi_test_123',
                },
            });

            expect(result).toEqual({
                clientSecret: 'secret_123',
                paymentIntentId: 'pi_test_123',
                expiresAt,
            });
        });

        it('should reject payment and expire the reservation when the hold has expired', async () => {
            mockDoctorFindUnique.mockResolvedValue({
                id: 'doctor-123',
                userId: 'user-123',
            });

            mockReservationFindFirst.mockResolvedValue({
                id: 'reservation-123',
                doctorId: 'doctor-123',
                roomId: 'room-123',
                totalPrice: 350,
                status: 'PENDING',
                expiresAt: new Date(
                    '2026-08-28T17:59:59.000Z',
                ),
            });

            mockReservationUpdate.mockResolvedValue({
                id: 'reservation-123',
                status: 'EXPIRED',
            });

            await expect(
                service.createPaymentIntent(
                    'user-123',
                    'reservation-123',
                ),
            ).rejects.toThrow(
                new BadRequestException(
                    'Reservation payment hold has expired',
                ),
            );

            expect(
                mockReservationUpdate,
            ).toHaveBeenCalledWith({
                where: {
                    id: 'reservation-123',
                },
                data: {
                    status: 'EXPIRED',
                },
            });

            expect(
                mockStripePaymentIntentsCreate,
            ).not.toHaveBeenCalled();
            expect(mockPaymentCreate).not.toHaveBeenCalled();
        });

        it('should reject payment when expiresAt is null', async () => {
            mockDoctorFindUnique.mockResolvedValue({
                id: 'doctor-123',
                userId: 'user-123',
            });

            mockReservationFindFirst.mockResolvedValue({
                id: 'reservation-123',
                doctorId: 'doctor-123',
                roomId: 'room-123',
                totalPrice: 350,
                status: 'PENDING',
                expiresAt: null,
            });

            mockReservationUpdate.mockResolvedValue({
                id: 'reservation-123',
                status: 'EXPIRED',
            });

            await expect(
                service.createPaymentIntent(
                    'user-123',
                    'reservation-123',
                ),
            ).rejects.toThrow(
                new BadRequestException(
                    'Reservation payment hold has expired',
                ),
            );

            expect(
                mockReservationUpdate,
            ).toHaveBeenCalledWith({
                where: {
                    id: 'reservation-123',
                },
                data: {
                    status: 'EXPIRED',
                },
            });
        });

        it('should reuse an existing active Stripe payment intent', async () => {
            const expiresAt = new Date(
                '2026-08-28T18:08:00.000Z',
            );

            mockDoctorFindUnique.mockResolvedValue({
                id: 'doctor-123',
                userId: 'user-123',
            });

            mockReservationFindFirst.mockResolvedValue({
                id: 'reservation-123',
                doctorId: 'doctor-123',
                roomId: 'room-123',
                totalPrice: 350,
                status: 'PENDING',
                expiresAt,
            });

            mockPaymentFindUnique.mockResolvedValue({
                id: 'payment-123',
                reservationId: 'reservation-123',
                status: 'PENDING',
                transactionId: 'pi_existing',
            });

            mockStripePaymentIntentsRetrieve.mockResolvedValue({
                id: 'pi_existing',
                status: 'requires_payment_method',
                client_secret: 'secret_existing',
            });

            const result =
                await service.createPaymentIntent(
                    'user-123',
                    'reservation-123',
                );

            expect(
                mockStripePaymentIntentsRetrieve,
            ).toHaveBeenCalledWith('pi_existing');

            expect(
                mockStripePaymentIntentsCreate,
            ).not.toHaveBeenCalled();

            expect(result).toEqual({
                clientSecret: 'secret_existing',
                paymentIntentId: 'pi_existing',
                expiresAt,
            });
        });

        it('should throw if doctor profile does not exist', async () => {
            mockDoctorFindUnique.mockResolvedValue(null);

            await expect(
                service.createPaymentIntent(
                    'user-123',
                    'reservation-123',
                ),
            ).rejects.toThrow(
                new NotFoundException(
                    'Doctor profile not found',
                ),
            );
        });

        it('should throw if reservation does not exist', async () => {
            mockDoctorFindUnique.mockResolvedValue({
                id: 'doctor-123',
            });

            mockReservationFindFirst.mockResolvedValue(null);

            await expect(
                service.createPaymentIntent(
                    'user-123',
                    'reservation-123',
                ),
            ).rejects.toThrow(
                new NotFoundException(
                    'Reservation not found',
                ),
            );
        });

        it('should reject a reservation that is not pending', async () => {
            mockDoctorFindUnique.mockResolvedValue({
                id: 'doctor-123',
            });

            mockReservationFindFirst.mockResolvedValue({
                id: 'reservation-123',
                doctorId: 'doctor-123',
                totalPrice: 350,
                status: 'CONFIRMED',
                expiresAt: null,
            });

            await expect(
                service.createPaymentIntent(
                    'user-123',
                    'reservation-123',
                ),
            ).rejects.toThrow(
                new BadRequestException(
                    'Only pending reservations can be paid',
                ),
            );
        });
    });

    describe('handleStripeWebhook', () => {
        it('should mark payment as PAID and reservation as CONFIRMED', async () => {
            const expiresAt = new Date(
                '2026-08-28T18:08:00.000Z',
            );

            mockStripeWebhookEventCreate.mockResolvedValue({
                id: 'evt_test_123',
                type: 'payment_intent.succeeded',
            });

            mockTxPaymentFindUnique.mockResolvedValue({
                id: 'payment-123',
                reservationId: 'reservation-123',
                amount: 350,
                status: 'PENDING',
                transactionId: 'pi_test_123',
            });

            mockTxReservationFindUnique.mockResolvedValue({
                id: 'reservation-123',
                roomId: 'room-123',
                startTime: new Date(
                    '2026-09-01T14:00:00.000Z',
                ),
                endTime: new Date(
                    '2026-09-01T15:00:00.000Z',
                ),
                status: 'PENDING',
                expiresAt,
            });

            mockTxReservationFindFirst.mockResolvedValue(null);

            mockTxPaymentUpdate.mockResolvedValue({
                id: 'payment-123',
                status: 'PAID',
            });

            mockTxReservationUpdate.mockResolvedValue({
                id: 'reservation-123',
                status: 'CONFIRMED',
            });

            const event = {
                id: 'evt_test_123',
                type: 'payment_intent.succeeded',
                created: 1787940180,
                data: {
                    object: {
                        id: 'pi_test_123',
                        amount: 35000,
                    },
                },
            } as Stripe.Event;

            const result =
                await service.handleStripeWebhook(event);

            expect(
                mockStripeWebhookEventCreate,
            ).toHaveBeenCalledWith({
                data: {
                    id: 'evt_test_123',
                    type: 'payment_intent.succeeded',
                },
            });

            expect(
                mockTxPaymentFindUnique,
            ).toHaveBeenCalledWith({
                where: {
                    transactionId: 'pi_test_123',
                },
            });

            expect(
                mockTxReservationFindUnique,
            ).toHaveBeenCalledWith({
                where: {
                    id: 'reservation-123',
                },
            });

            expect(
                mockTxReservationFindFirst,
            ).toHaveBeenCalledWith({
                where: {
                    id: {
                        not: 'reservation-123',
                    },
                    roomId: 'room-123',
                    startTime: {
                        lt: new Date(
                            '2026-09-01T15:00:00.000Z',
                        ),
                    },
                    endTime: {
                        gt: new Date(
                            '2026-09-01T14:00:00.000Z',
                        ),
                    },
                    OR: [
                        {
                            status: 'CONFIRMED',
                        },
                        {
                            status: 'PENDING',
                            expiresAt: {
                                gt: NOW,
                            },
                        },
                    ],
                },
            });

            expect(
                mockTxPaymentUpdate,
            ).toHaveBeenCalledWith({
                where: {
                    id: 'payment-123',
                },
                data: {
                    status: 'PAID',
                },
            });

            expect(
                mockTxReservationUpdate,
            ).toHaveBeenCalledWith({
                where: {
                    id: 'reservation-123',
                },
                data: {
                    status: 'CONFIRMED',
                },
            });

            expect(
                mockStripeRefundsCreate,
            ).not.toHaveBeenCalled();

            expect(result).toEqual({
                duplicate: false,
                processed: true,
            });
        });

        it('should refund a payment that succeeded after the hold expired', async () => {
            mockStripeWebhookEventCreate.mockResolvedValue({
                id: 'evt_expired',
                type: 'payment_intent.succeeded',
            });

            mockTxPaymentFindUnique.mockResolvedValue({
                id: 'payment-123',
                reservationId: 'reservation-123',
                amount: 350,
                status: 'PENDING',
                transactionId: 'pi_expired',
            });

            mockTxReservationFindUnique.mockResolvedValue({
                id: 'reservation-123',
                roomId: 'room-123',
                startTime: new Date(
                    '2026-09-01T14:00:00.000Z',
                ),
                endTime: new Date(
                    '2026-09-01T15:00:00.000Z',
                ),
                status: 'PENDING',
                expiresAt: new Date(
                    '2026-08-28T18:08:00.000Z',
                ),
            });

            mockStripeRefundsCreate.mockResolvedValue({
                id: 're_expired',
            });

            mockTxPaymentUpdate.mockResolvedValue({
                id: 'payment-123',
                status: 'REFUNDED',
            });

            mockTxReservationUpdate.mockResolvedValue({
                id: 'reservation-123',
                status: 'EXPIRED',
            });

            const event = {
                id: 'evt_expired',
                type: 'payment_intent.succeeded',
                created: 1787940540,
                data: {
                    object: {
                        id: 'pi_expired',
                        amount: 35000,
                    },
                },
            } as Stripe.Event;

            const result =
                await service.handleStripeWebhook(event);

            expect(
                mockStripeRefundsCreate,
            ).toHaveBeenCalledWith(
                {
                    payment_intent: 'pi_expired',
                },
                {
                    idempotencyKey:
                        'expired-reservation-refund-pi_expired',
                },
            );

            expect(
                mockTxPaymentUpdate,
            ).toHaveBeenCalledWith({
                where: {
                    id: 'payment-123',
                },
                data: {
                    status: 'REFUNDED',
                },
            });

            expect(
                mockTxReservationUpdate,
            ).toHaveBeenCalledWith({
                where: {
                    id: 'reservation-123',
                },
                data: {
                    status: 'EXPIRED',
                },
            });

            expect(result).toEqual({
                duplicate: false,
                processed: true,
                refunded: true,
            });
        });

        it('should refund when another reservation conflicts with the paid reservation', async () => {
            mockStripeWebhookEventCreate.mockResolvedValue({
                id: 'evt_conflict',
                type: 'payment_intent.succeeded',
            });

            mockTxPaymentFindUnique.mockResolvedValue({
                id: 'payment-123',
                reservationId: 'reservation-123',
                amount: 350,
                status: 'PENDING',
                transactionId: 'pi_conflict',
            });

            mockTxReservationFindUnique.mockResolvedValue({
                id: 'reservation-123',
                roomId: 'room-123',
                startTime: new Date(
                    '2026-09-01T14:00:00.000Z',
                ),
                endTime: new Date(
                    '2026-09-01T15:00:00.000Z',
                ),
                status: 'PENDING',
                expiresAt: new Date(
                    '2026-08-28T18:08:00.000Z',
                ),
            });

            mockTxReservationFindFirst.mockResolvedValue({
                id: 'reservation-other',
                roomId: 'room-123',
                status: 'CONFIRMED',
            });

            mockStripeRefundsCreate.mockResolvedValue({
                id: 're_conflict',
            });

            const event = {
                id: 'evt_conflict',
                type: 'payment_intent.succeeded',
                created: 1787940180,
                data: {
                    object: {
                        id: 'pi_conflict',
                        amount: 35000,
                    },
                },
            } as Stripe.Event;

            const result =
                await service.handleStripeWebhook(event);

            expect(
                mockStripeRefundsCreate,
            ).toHaveBeenCalledWith(
                {
                    payment_intent: 'pi_conflict',
                },
                {
                    idempotencyKey:
                        'reservation-conflict-refund-pi_conflict',
                },
            );

            expect(
                mockTxPaymentUpdate,
            ).toHaveBeenCalledWith({
                where: {
                    id: 'payment-123',
                },
                data: {
                    status: 'REFUNDED',
                },
            });

            expect(result).toEqual({
                duplicate: false,
                processed: true,
                refunded: true,
            });
        });

        it('should refund a payment for an already expired reservation', async () => {
            mockStripeWebhookEventCreate.mockResolvedValue({
                id: 'evt_already_expired',
                type: 'payment_intent.succeeded',
            });

            mockTxPaymentFindUnique.mockResolvedValue({
                id: 'payment-123',
                reservationId: 'reservation-123',
                amount: 350,
                status: 'PENDING',
                transactionId: 'pi_already_expired',
            });

            mockTxReservationFindUnique.mockResolvedValue({
                id: 'reservation-123',
                roomId: 'room-123',
                startTime: new Date(
                    '2026-09-01T14:00:00.000Z',
                ),
                endTime: new Date(
                    '2026-09-01T15:00:00.000Z',
                ),
                status: 'EXPIRED',
                expiresAt: new Date(
                    '2026-08-28T18:08:00.000Z',
                ),
            });

            mockStripeRefundsCreate.mockResolvedValue({
                id: 're_already_expired',
            });

            const event = {
                id: 'evt_already_expired',
                type: 'payment_intent.succeeded',
                created: 1787940180,
                data: {
                    object: {
                        id: 'pi_already_expired',
                        amount: 35000,
                    },
                },
            } as Stripe.Event;

            const result =
                await service.handleStripeWebhook(event);

            expect(
                mockStripeRefundsCreate,
            ).toHaveBeenCalled();

            expect(
                mockTxReservationFindFirst,
            ).not.toHaveBeenCalled();

            expect(result).toEqual({
                duplicate: false,
                processed: true,
                refunded: true,
            });
        });

        it('should reject the webhook if the payment amount does not match', async () => {
            mockStripeWebhookEventCreate.mockResolvedValue({
                id: 'evt_test_amount',
                type: 'payment_intent.succeeded',
            });

            mockTxPaymentFindUnique.mockResolvedValue({
                id: 'payment-123',
                reservationId: 'reservation-123',
                amount: 350,
                status: 'PENDING',
                transactionId: 'pi_test_amount',
            });

            const event = {
                id: 'evt_test_amount',
                type: 'payment_intent.succeeded',
                created: 1787940180,
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

            expect(
                mockTxPaymentUpdate,
            ).not.toHaveBeenCalled();
            expect(
                mockTxReservationUpdate,
            ).not.toHaveBeenCalled();
        });

        it('should throw if the payment does not exist', async () => {
            mockStripeWebhookEventCreate.mockResolvedValue({
                id: 'evt_test_missing_payment',
                type: 'payment_intent.succeeded',
            });

            mockTxPaymentFindUnique.mockResolvedValue(null);

            const event = {
                id: 'evt_test_missing_payment',
                type: 'payment_intent.succeeded',
                created: 1787940180,
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
                new NotFoundException(
                    'Payment not found',
                ),
            );

            expect(
                mockTxPaymentUpdate,
            ).not.toHaveBeenCalled();
            expect(
                mockTxReservationUpdate,
            ).not.toHaveBeenCalled();
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
                created: 1787940180,
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

            expect(
                mockTxPaymentFindUnique,
            ).not.toHaveBeenCalled();
            expect(
                mockTxPaymentUpdate,
            ).not.toHaveBeenCalled();
            expect(
                mockTxReservationUpdate,
            ).not.toHaveBeenCalled();
        });
    });
});
