import { decodePatientCursor, encodePatientCursor, normalizePhone, patientPageWhere, searchTerms } from './patient-search';

const position = { l: 'Doe', f: 'John', i: '12345678-1234-4234-8234-123456789abc' };
describe('patient search and cursor', () => {
  it('round trips an opaque cursor', () => {
    expect(decodePatientCursor(encodePatientCursor(position), '')).toEqual(position);
    const queried = { ...position, q: 'john doe' };
    expect(decodePatientCursor(encodePatientCursor(queried), queried.q)).toEqual(queried);
  });
  it.each(['?', 'YQ==', 'a', Buffer.from('{').toString('base64url'),
    Buffer.from('null').toString('base64url'), Buffer.from('[]').toString('base64url')])(
    'rejects malformed cursor %s', cursor => {
      expect(() => decodePatientCursor(cursor, '')).toThrow('Invalid patient cursor');
    },
  );
  it.each([
    { ...position, i: 'invalid' }, { ...position, l: 123 }, { ...position, f: null },
    { ...position, l: 'a'.repeat(81) }, { ...position, f: 'a'.repeat(81) },
    { ...position, extra: true }, { l: 'Doe', i: position.i },
    { ...position, q: null }, { ...position, q: 'a'.repeat(81) },
  ])('rejects invalid structure %p', data => {
    expect(() => decodePatientCursor(encodePatientCursor(data as any), '')).toThrow('Invalid patient cursor');
  });
  it('rejects mismatched search and excessive cursor length', () => {
    expect(() => decodePatientCursor(encodePatientCursor({ ...position, q: 'john' }), 'doe'))
      .toThrow('Invalid patient cursor');
    expect(() => decodePatientCursor('a'.repeat(2049), '')).toThrow('Invalid patient cursor');
  });
  it.each([
    [undefined, []], [' John  DOE ', ['john', 'doe']], ['john', ['john']],
    ['one two three four', ['one', 'two', 'three', 'four']],
  ])('normalizes query %p', (query, expected) => {
    expect(searchTerms(query)).toEqual(expected);
  });
  it.each(['', ' ', 'a', '%', 'a'.repeat(81), 'one two three four five'])('rejects query %p', q => {
    expect(() => searchTerms(q)).toThrow('Invalid patient search');
  });
  it('keeps ownership for searches and keyset, with no offset', () => {
    expect(patientPageWhere('doctor', [], position)).toEqual({ doctorId: 'doctor', AND: [{ OR: [
      { lastName: { gt: 'Doe' } },
      { lastName: 'Doe', firstName: { gt: 'John' } },
      { lastName: 'Doe', firstName: 'John', id: { gt: position.i } },
    ] }] });
    expect(patientPageWhere('doctor', [])).toEqual({ doctorId: 'doctor' });
  });
  it('combines terms with AND, fields with OR and escapes LIKE wildcards and backslash', () => {
    const where = patientPageWhere('doctor', ['ab%', 'a_', 'a\\b']) as any;
    expect(where.doctorId).toBe('doctor');
    expect(where.AND).toHaveLength(3);
    expect(where.AND.map((term: any) => term.OR[0].firstName))
      .toEqual(['ab\\%', 'a\\_', 'a\\\\b'].map(contains => ({ contains, mode: 'insensitive' })));
  });
  it('only includes phone for terms containing at least three digits', () => {
    const where = patientPageWhere('doctor', ['44', '442-123', 'mail@example.com']) as any;
    expect(where.AND.map((term: any) => term.OR.length)).toEqual([3, 4, 3]);
    expect(where.AND[1].OR[3]).toEqual({ phone: { contains: '442123' } });
  });
  it('preserves national and international prefixes during normalization', () => {
    expect(normalizePhone('442 123 4567')).toBe('4421234567');
    expect(normalizePhone('+52 (442) 123-4567')).toBe('+524421234567');
    expect(normalizePhone(null)).toBeNull();
  });
});
