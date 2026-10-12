import { PatientsService } from './patients.service';
import { PrismaService } from '../prisma/prisma.service';

describe('patient null regression', () => {
  it('persists null birth date instead of the Unix epoch', async () => {
    const prisma = {
      doctorProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'doctor-1' }) },
      patient: {
        findFirst: jest.fn().mockResolvedValue({ id: 'patient-1' }),
        update: jest.fn().mockResolvedValue({ id: 'patient-1', dateOfBirth: null }),
      },
    };
    const service = new PatientsService(prisma as unknown as PrismaService);
    await service.update('user-1', 'patient-1', { dateOfBirth: null } as any);
    expect(prisma.patient.update.mock.calls[0][0].data.dateOfBirth).toBeNull();
  });
});
