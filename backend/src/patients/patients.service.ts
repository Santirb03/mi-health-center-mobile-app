import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { PatientPageDto } from './dto/patient-page.dto';
import { decodePatientCursor, encodePatientCursor, patientPageWhere, searchTerms } from './patient-search';

@Injectable()
export class PatientsService {
    constructor(
        private readonly prisma: PrismaService,
    ) { }

    async create(userId: string, dto: CreatePatientDto) {
        const doctorId = await this.requireDoctorId(userId);

        const patient = await this.prisma.patient.create({
            data: {
                doctorId,
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
        const doctorId = await this.requireDoctorId(userId);

        return this.prisma.patient.findMany({
            where: {
                doctorId,
            },
            orderBy: {
                lastName: 'asc',
            },
        });
    }

    async findOne(userId: string, patientId: string) {
        const doctorId = await this.requireDoctorId(userId);

        const patient = await this.prisma.patient.findFirst({
            where: {
                id: patientId,
                doctorId,
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
        const doctorId = await this.requireDoctorId(userId);

        const patient = await this.prisma.patient.findFirst({
            where: {
                id: patientId,
                doctorId,
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
                    dateOfBirth: dto.dateOfBirth === null ? null : new Date(dto.dateOfBirth),
                }),
            },
        });
    }
    private async requireDoctorId(userId: string): Promise<string> {
        const doctor = await this.prisma.doctorProfile.findUnique({ where: { userId } });
        if (!doctor) throw new NotFoundException('Doctor profile not found');
        return doctor.id;
    }

    async findPage(userId: string, query: PatientPageDto) {
        const doctorId = await this.requireDoctorId(userId);
        const terms = searchTerms(query.q);
        const q = terms.join(' ');
        const cursor = query.cursor === undefined ? undefined : decodePatientCursor(query.cursor, q);
        const rows = await this.prisma.patient.findMany({
            where: patientPageWhere(doctorId, terms, cursor),
            orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
            take: 21,
            select: {
                id: true, firstName: true, lastName: true, phone: true, email: true,
                dateOfBirth: true, createdAt: true, updatedAt: true,
            },
        });
        const items = rows.slice(0, 20);
        const last = items[items.length - 1];
        return {
            items,
            nextCursor: rows.length > 20 && last ? encodePatientCursor({
                l: last.lastName, f: last.firstName, i: last.id, ...(q ? { q } : {}),
            }) : null,
        };
    }
}
