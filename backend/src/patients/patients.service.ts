import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';

@Injectable()
export class PatientsService {
    constructor(
        private readonly prisma: PrismaService,
    ) { }

    async create(userId: string, dto: CreatePatientDto) {
        const doctor = await this.prisma.doctorProfile.findUnique({
            where: {
                userId,
            },
        });

        if (!doctor) {
            throw new NotFoundException(
                'Doctor profile not found',
            );
        }

        const patient = await this.prisma.patient.create({
            data: {
                doctorId: doctor.id,
                firstName: dto.firstName,
                lastName: dto.lastName,
                phone: dto.phone,
                email: dto.email,
                dateOfBirth: dto.dateOfBirth
                    ? new Date(dto.dateOfBirth)
                    : undefined,
            },
        });

        return patient;
    }

    async findAll(userId: string) {
        const doctor = await this.prisma.doctorProfile.findUnique({
            where: {
                userId,
            },
        });

        if (!doctor) {
            throw new NotFoundException(
                'Doctor profile not found',
            );
        }

        return this.prisma.patient.findMany({
            where: {
                doctorId: doctor.id,
            },
            orderBy: {
                lastName: 'asc',
            },
        });
    }

    async findOne(userId: string, patientId: string) {
        const doctor = await this.prisma.doctorProfile.findUnique({
            where: {
                userId,
            },
        });

        if (!doctor) {
            throw new NotFoundException(
                'Doctor profile not found',
            );
        }

        const patient = await this.prisma.patient.findFirst({
            where: {
                id: patientId,
                doctorId: doctor.id,
            },
        });

        if (!patient) {
            throw new NotFoundException(
                'Patient not found',
            );
        }

        return patient;
    }

    async update(
        userId: string,
        patientId: string,
        dto: UpdatePatientDto,
    ) {
        const doctor = await this.prisma.doctorProfile.findUnique({
            where: {
                userId,
            },
        });

        if (!doctor) {
            throw new NotFoundException(
                'Doctor profile not found',
            );
        }

        const patient = await this.prisma.patient.findFirst({
            where: {
                id: patientId,
                doctorId: doctor.id,
            },
        });

        if (!patient) {
            throw new NotFoundException(
                'Patient not found',
            );
        }

        if (
            dto.firstName === undefined &&
            dto.lastName === undefined &&
            dto.phone === undefined &&
            dto.email === undefined &&
            dto.dateOfBirth === undefined
        ) {
            throw new BadRequestException(
                'At least one field is required to update the patient',
            );
        }

        return this.prisma.patient.update({
            where: {
                id: patient.id,
            },
            data: {
                ...(dto.firstName !== undefined && {
                    firstName: dto.firstName,
                }),

                ...(dto.lastName !== undefined && {
                    lastName: dto.lastName,
                }),

                ...(dto.phone !== undefined && {
                    phone: dto.phone,
                }),

                ...(dto.email !== undefined && {
                    email: dto.email,
                }),

                ...(dto.dateOfBirth !== undefined && {
                    dateOfBirth: new Date(dto.dateOfBirth),
                }),
            },
        });
    }
}