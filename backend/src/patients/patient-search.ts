import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';

export function normalizePhone(value: unknown): unknown {
  // Do not let normalization hide excessive or invalid input.
  if (typeof value !== 'string' || value.length > 40) return value;
  return value.trim().replace(/[\s()-]/g, '');
}

export function searchTerms(q?: string): string[] {
  if (q === undefined) return [];
  if (typeof q !== 'string') throw new BadRequestException('Invalid patient search');
  const trimmed = q.trim();
  const terms = trimmed.split(/\s+/);
  if (trimmed.length < 2 || trimmed.length > 80 || terms.length > 4) {
    throw new BadRequestException('Invalid patient search');
  }
  return terms.map(term => term.toLowerCase());
}

export type PatientCursor = { l: string; f: string; i: string; q?: string };

export function encodePatientCursor(position: PatientCursor): string {
  return Buffer.from(JSON.stringify(position)).toString('base64url');
}

export function decodePatientCursor(cursor: string, q: string): PatientCursor {
  try {
    if (cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) throw new Error();
    if (!Buffer.from(bytes.toString('utf8')).equals(bytes)) throw new Error();
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const data = value as Record<string, unknown>;
    if (Object.keys(data).some(key => !['l', 'f', 'i', 'q'].includes(key))) throw new Error();
    if (typeof data.l !== 'string' || data.l.length > 80
      || typeof data.f !== 'string' || data.f.length > 80
      || typeof data.i !== 'string' || !isUUID(data.i)
      || ('q' in data && (typeof data.q !== 'string' || data.q.length > 80))
      || (data.q ?? '') !== q) throw new Error();
    return data as PatientCursor;
  } catch {
    throw new BadRequestException('Invalid patient cursor');
  }
}

function literalContains(term: string): string {
  return term.replace(/[\\%_]/g, character => `\\${character}`);
}

export function patientPageWhere(
  doctorId: string,
  terms: string[],
  cursor?: PatientCursor,
): Prisma.PatientWhereInput {
  const conditions: Prisma.PatientWhereInput[] = terms.map(term => {
    const contains = literalContains(term);
    const digits = term.replace(/\D/g, '');
    return { OR: [
      { firstName: { contains, mode: 'insensitive' } },
      { lastName: { contains, mode: 'insensitive' } },
      { email: { contains, mode: 'insensitive' } },
      ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
    ] };
  });
  if (cursor) conditions.push({ OR: [
    { lastName: { gt: cursor.l } },
    { lastName: cursor.l, firstName: { gt: cursor.f } },
    { lastName: cursor.l, firstName: cursor.f, id: { gt: cursor.i } },
  ] });
  // PostgreSQL performs both comparisons and ordering with its own collation.
  return { doctorId, ...(conditions.length ? { AND: conditions } : {}) };
}
