import { Transform } from 'class-transformer';
import { ValidateBy } from 'class-validator';
import { agendaDay } from '../../reservations/admin-agenda.service';
import { normalizePhone } from '../patient-search';

export const TrimText = () => Transform(({ value }) =>
  typeof value === 'string' ? value.trim() : value);
export const NormalizePhone = () => Transform(({ value }) => normalizePhone(value));

export function validBirthDate(value: unknown): boolean {
  if (typeof value !== 'string' || value < '1900-01-01') return false;
  try {
    agendaDay(value);
  } catch {
    return false;
  }
  // Convert the instant to UTC-06 before extracting its business civil date.
  const today = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return value <= today;
}

export const IsBirthDate = () => ValidateBy({
  name: 'isBirthDate',
  validator: {
    validate: validBirthDate,
    defaultMessage: () => 'dateOfBirth must be a real YYYY-MM-DD date from 1900 through today',
  },
});
