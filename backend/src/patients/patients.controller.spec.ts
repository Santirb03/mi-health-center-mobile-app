import { Test, TestingModule } from '@nestjs/testing';

import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';

describe('PatientsController', () => {
    let controller: PatientsController;

    const mockPatientsService = {
        create: jest.fn(),
        findAll: jest.fn(),
        findOne: jest.fn(),
        update: jest.fn(),
    };

    const mockRequest = {
        user: {
            userId: 'user-1',
            email: 'doctor@test.com',
            role: 'DOCTOR',
        },
    } as any;

    beforeEach(async () => {
        jest.clearAllMocks();

        const module: TestingModule =
            await Test.createTestingModule({
                controllers: [PatientsController],
                providers: [
                    {
                        provide: PatientsService,
                        useValue: mockPatientsService,
                    },
                ],
            }).compile();

        controller =
            module.get<PatientsController>(PatientsController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('create', () => {
        it('should call PatientsService.create with the user id and DTO', async () => {
            const dto = {
                firstName: 'John',
                lastName: 'Doe',
                phone: '4421234567',
                email: 'john@test.com',
            };

            const patient = {
                id: 'patient-1',
                ...dto,
            };

            mockPatientsService.create.mockResolvedValue(patient);

            const result = await controller.create(
                mockRequest,
                dto,
            );

            expect(result).toEqual(patient);

            expect(
                mockPatientsService.create,
            ).toHaveBeenCalledWith('user-1', dto);
        });
    });

    describe('findAll', () => {
        it('should call PatientsService.findAll with the user id', async () => {
            const patients = [
                {
                    id: 'patient-1',
                    firstName: 'John',
                    lastName: 'Doe',
                },
            ];

            mockPatientsService.findAll.mockResolvedValue(
                patients,
            );

            const result = await controller.findAll(
                mockRequest,
            );

            expect(result).toEqual(patients);

            expect(
                mockPatientsService.findAll,
            ).toHaveBeenCalledWith('user-1');
        });
    });

    describe('findOne', () => {
        it('should call PatientsService.findOne with the user id and patient id', async () => {
            const patient = {
                id: 'patient-1',
                firstName: 'John',
                lastName: 'Doe',
            };

            mockPatientsService.findOne.mockResolvedValue(
                patient,
            );

            const result = await controller.findOne(
                mockRequest,
                'patient-1',
            );

            expect(result).toEqual(patient);

            expect(
                mockPatientsService.findOne,
            ).toHaveBeenCalledWith(
                'user-1',
                'patient-1',
            );
        });
    });

    describe('update', () => {
        it('should call PatientsService.update with the user id, patient id and DTO', async () => {
            const dto = {
                firstName: 'Jonathan',
                phone: '4429876543',
            };

            const patient = {
                id: 'patient-1',
                firstName: 'Jonathan',
                phone: '4429876543',
            };

            mockPatientsService.update.mockResolvedValue(
                patient,
            );

            const result = await controller.update(
                mockRequest,
                'patient-1',
                dto,
            );

            expect(result).toEqual(patient);

            expect(
                mockPatientsService.update,
            ).toHaveBeenCalledWith(
                'user-1',
                'patient-1',
                dto,
            );
        });
    });
});