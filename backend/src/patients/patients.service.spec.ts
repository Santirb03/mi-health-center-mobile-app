import {
    BadRequestException,
    NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PatientsService } from './patients.service';
import { PrismaService } from '../prisma/prisma.service';

describe('PatientsService', () => {
    let service: PatientsService;

    const mockPrisma = {
        doctorProfile: {
            findUnique: jest.fn(),
        },
        patient: {
            create: jest.fn(),
            findMany: jest.fn(),
            findFirst: jest.fn(),
            update: jest.fn(),
        },
    };

    beforeEach(async () => {
        jest.clearAllMocks();

        const module: TestingModule =
            await Test.createTestingModule({
                providers: [
                    PatientsService,
                    {
                        provide: PrismaService,
                        useValue: mockPrisma,
                    },
                ],
            }).compile();

        service = module.get<PatientsService>(PatientsService);
    });

    describe('create', () => {
        it('should throw if the doctor profile does not exist', async () => {
            mockPrisma.doctorProfile.findUnique.mockResolvedValue(null);

            await expect(
                service.create('user-1', {
                    firstName: 'John',
                    lastName: 'Doe',
                }),
            ).rejects.toThrow(NotFoundException);

            expect(mockPrisma.patient.create).not.toHaveBeenCalled();
        });

        it('should create a patient', async () => {
            const doctor = {
                id: 'doctor-1',
                userId: 'user-1',
            };

            const patient = {
                id: 'patient-1',
                doctorId: 'doctor-1',
                firstName: 'John',
                lastName: 'Doe',
                phone: '4421234567',
                email: 'john@test.com',
                dateOfBirth: new Date('1990-01-01'),
            };

            mockPrisma.doctorProfile.findUnique.mockResolvedValue(doctor);
            mockPrisma.patient.create.mockResolvedValue(patient);

            const result = await service.create('user-1', {
                firstName: 'John',
                lastName: 'Doe',
                phone: '4421234567',
                email: 'john@test.com',
                dateOfBirth: '1990-01-01',
            });

            expect(result).toEqual(patient);

            expect(mockPrisma.patient.create).toHaveBeenCalledWith({
                data: {
                    doctorId: 'doctor-1',
                    firstName: 'John',
                    lastName: 'Doe',
                    phone: '4421234567',
                    email: 'john@test.com',
                    dateOfBirth: new Date('1990-01-01'),
                },
            });
        });
    });

    describe('findAll', () => {
        it('should throw if the doctor profile does not exist', async () => {
            mockPrisma.doctorProfile.findUnique.mockResolvedValue(null);

            await expect(
                service.findAll('user-1'),
            ).rejects.toThrow(NotFoundException);

            expect(mockPrisma.patient.findMany).not.toHaveBeenCalled();
        });

        it('should return the doctor patients', async () => {
            const doctor = {
                id: 'doctor-1',
                userId: 'user-1',
            };

            const patients = [
                {
                    id: 'patient-1',
                    firstName: 'John',
                    lastName: 'Doe',
                },
                {
                    id: 'patient-2',
                    firstName: 'Jane',
                    lastName: 'Smith',
                },
            ];

            mockPrisma.doctorProfile.findUnique.mockResolvedValue(doctor);
            mockPrisma.patient.findMany.mockResolvedValue(patients);

            const result = await service.findAll('user-1');

            expect(result).toEqual(patients);

            expect(mockPrisma.patient.findMany).toHaveBeenCalledWith({
                where: {
                    doctorId: 'doctor-1',
                },
                orderBy: {
                    lastName: 'asc',
                },
            });
        });
    });

    describe('findOne', () => {
        it('should throw if the doctor profile does not exist', async () => {
            mockPrisma.doctorProfile.findUnique.mockResolvedValue(null);

            await expect(
                service.findOne('user-1', 'patient-1'),
            ).rejects.toThrow(NotFoundException);
        });

        it('should throw if the patient does not belong to the doctor', async () => {
            mockPrisma.doctorProfile.findUnique.mockResolvedValue({
                id: 'doctor-1',
            });

            mockPrisma.patient.findFirst.mockResolvedValue(null);

            await expect(
                service.findOne('user-1', 'patient-1'),
            ).rejects.toThrow(NotFoundException);
        });

        it('should return the patient', async () => {
            const patient = {
                id: 'patient-1',
                doctorId: 'doctor-1',
                firstName: 'John',
                lastName: 'Doe',
            };

            mockPrisma.doctorProfile.findUnique.mockResolvedValue({
                id: 'doctor-1',
            });

            mockPrisma.patient.findFirst.mockResolvedValue(patient);

            const result = await service.findOne(
                'user-1',
                'patient-1',
            );

            expect(result).toEqual(patient);

            expect(mockPrisma.patient.findFirst).toHaveBeenCalledWith({
                where: {
                    id: 'patient-1',
                    doctorId: 'doctor-1',
                },
            });
        });
    });

    describe('update', () => {
        it('should throw if the doctor profile does not exist', async () => {
            mockPrisma.doctorProfile.findUnique.mockResolvedValue(null);

            await expect(
                service.update('user-1', 'patient-1', {
                    firstName: 'Updated',
                }),
            ).rejects.toThrow(NotFoundException);
        });

        it('should throw if the patient does not belong to the doctor', async () => {
            mockPrisma.doctorProfile.findUnique.mockResolvedValue({
                id: 'doctor-1',
            });

            mockPrisma.patient.findFirst.mockResolvedValue(null);

            await expect(
                service.update('user-1', 'patient-1', {
                    firstName: 'Updated',
                }),
            ).rejects.toThrow(NotFoundException);
        });

        it('should throw if no fields are provided', async () => {
            mockPrisma.doctorProfile.findUnique.mockResolvedValue({
                id: 'doctor-1',
            });

            mockPrisma.patient.findFirst.mockResolvedValue({
                id: 'patient-1',
                doctorId: 'doctor-1',
            });

            await expect(
                service.update('user-1', 'patient-1', {}),
            ).rejects.toThrow(BadRequestException);

            expect(mockPrisma.patient.update).not.toHaveBeenCalled();
        });

        it('should update the patient', async () => {
            const existingPatient = {
                id: 'patient-1',
                doctorId: 'doctor-1',
                firstName: 'John',
                lastName: 'Doe',
            };

            const updatedPatient = {
                ...existingPatient,
                firstName: 'Jonathan',
                phone: '4421234567',
            };

            mockPrisma.doctorProfile.findUnique.mockResolvedValue({
                id: 'doctor-1',
            });

            mockPrisma.patient.findFirst.mockResolvedValue(
                existingPatient,
            );

            mockPrisma.patient.update.mockResolvedValue(
                updatedPatient,
            );

            const result = await service.update(
                'user-1',
                'patient-1',
                {
                    firstName: 'Jonathan',
                    phone: '4421234567',
                },
            );

            expect(result).toEqual(updatedPatient);

            expect(mockPrisma.patient.update).toHaveBeenCalledWith({
                where: {
                    id: 'patient-1',
                },
                data: {
                    firstName: 'Jonathan',
                    phone: '4421234567',
                },
            });
        });
    });
});