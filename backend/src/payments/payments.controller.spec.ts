import { Test, TestingModule } from '@nestjs/testing';

import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

describe('PaymentsController', () => {
    let controller: PaymentsController;

    const mockPaymentsService = {
        createPaymentIntent: jest.fn(),
    };

    beforeEach(async () => {
        jest.clearAllMocks();

        const module: TestingModule =
            await Test.createTestingModule({
                controllers: [PaymentsController],
                providers: [
                    {
                        provide: PaymentsService,
                        useValue: mockPaymentsService,
                    },
                ],
            }).compile();

        controller =
            module.get<PaymentsController>(
                PaymentsController,
            );
    });

    describe('createPaymentIntent', () => {
        it('should create a payment intent for the reservation', async () => {
            const req = {
                user: {
                    userId: 'user-123',
                    email: 'doctor@test.com',
                    role: 'DOCTOR',
                },
            } as any;

            const expectedResult = {
                clientSecret: 'pi_test_secret',
            };

            mockPaymentsService.createPaymentIntent.mockResolvedValue(
                expectedResult,
            );

            const result =
                await controller.createPaymentIntent(
                    req,
                    'reservation-123',
                );

            expect(
                mockPaymentsService.createPaymentIntent,
            ).toHaveBeenCalledWith('reservation-123');

            expect(result).toEqual(expectedResult);
        });
    });
});