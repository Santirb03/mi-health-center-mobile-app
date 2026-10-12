import { ValidationPipe } from '@nestjs/common';
import { isPhoneNumber } from 'class-validator';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { PatientPageDto } from './dto/patient-page.dto';
import { validBirthDate } from './dto/patient-validation';

const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
const transform = (type: typeof CreatePatientDto | typeof UpdatePatientDto, value: object) =>
  pipe.transform(value, { type: 'body', metatype: type });

describe('patient validation with the real ValidationPipe', () => {
  const names = { firstName: 'John', lastName: 'Doe' };
  it('trims names and email without lowercasing it', async () => {
    const dto = await transform(CreatePatientDto, {
      firstName: '  John ', lastName: ' Doe  ', email: ' John@Example.com ',
    });
    expect(dto).toMatchObject({ ...names, email: 'John@Example.com' });
  });
  for (const type of [CreatePatientDto, UpdatePatientDto]) {
    for (const field of ['firstName', 'lastName']) {
      it.each(['a', '', '   ', null, 42, {}, 'a'.repeat(81)])(
        `${type.name} rejects invalid ${field}: %p`, async value => {
          await expect(transform(type, { ...names, [field]: value })).rejects.toMatchObject({ status: 400 });
        },
      );
      it.each([2, 80])(`${type.name} accepts ${field} length %i`, async length => {
        await expect(transform(type, { ...names, [field]: 'a'.repeat(length) })).resolves.toBeDefined();
      });
    }
    it.each([
      ['4421234567', '4421234567'],
      ['(442) 123-4567', '4421234567'],
      ['+52 (442) 123-4567', '+524421234567'],
    ])(`${type.name} normalizes phone %s`, async (phone, expected) => {
      expect(isPhoneNumber(phone, 'MX')).toBe(true);
      expect((await transform(type, { ...names, phone })).phone).toBe(expected);
    });
    it.each(['', 'not a phone', '+14421234567', ' '.repeat(41) + '4421234567', 123])(
      `${type.name} rejects phone %p`, async phone => {
        await expect(transform(type, { ...names, phone })).rejects.toMatchObject({ status: 400 });
      },
    );
    it.each(['', ' ', 'invalid', 'a'.repeat(255) + '@example.com', 123])(
      `${type.name} rejects email %p`, async email => {
        await expect(transform(type, { ...names, email })).rejects.toMatchObject({ status: 400 });
      },
    );
    it.each(['2000-02-29', '1990-01-01', '1900-01-01'])(`${type.name} accepts date %s`, async dateOfBirth => {
      await expect(transform(type, { ...names, dateOfBirth })).resolves.toBeDefined();
    });
    it.each(['2025-02-30', '1900-02-29', '1899-12-31', '9999-01-01', '2035-01-01',
      '1990-01-01T23:00:00-06:00', '1990-01-01T00:00:00Z', '', 123])(
      `${type.name} rejects date %p`, async dateOfBirth => {
        await expect(transform(type, { ...names, dateOfBirth })).rejects.toMatchObject({ status: 400 });
      },
    );
    it('accepts absent and null optional values', async () => {
      await expect(transform(type, names)).resolves.toBeDefined();
      expect(await transform(type, { ...names, phone: null, email: null, dateOfBirth: null }))
        .toMatchObject({ phone: null, email: null, dateOfBirth: null });
    });
    it('rejects client-supplied doctorId', async () => {
      await expect(transform(type, { ...names, doctorId: 'foreign-doctor' })).rejects.toMatchObject({ status: 400 });
    });
  }
  it('uses UTC-06 day near UTC midnight and business midnight', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-10T00:30:00Z'));
    try {
      expect(validBirthDate('2026-10-09')).toBe(true);
      expect(validBirthDate('2026-10-10')).toBe(false);
      jest.setSystemTime(new Date('2026-10-10T06:00:00Z'));
      expect(validBirthDate('2026-10-10')).toBe(true);
    } finally { jest.useRealTimers(); }
  });
  it('rejects unknown query fields and null query values', async () => {
    for (const value of [{ doctorId: 'x' }, { q: null }, { q: ['ab'] }, { cursor: null }]) {
      await expect(pipe.transform(value, { type: 'query', metatype: PatientPageDto }))
        .rejects.toMatchObject({ status: 400 });
    }
  });
});
