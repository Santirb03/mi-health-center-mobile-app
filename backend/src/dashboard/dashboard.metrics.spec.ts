import { availableMinutes, blockedMinutes, bookedMinutes, decimalCents, formatCents, unionIntervals, utilizationBp } from './dashboard.metrics';
import { DashboardService } from './dashboard.service';
import type { OperatingDay } from './dashboard.metrics';
import { agendaDay } from '../reservations/admin-agenda.service';
import { OPENING_HOUR, CLOSING_HOUR } from '../reservations/reservations.service';

const minute = 60000;
const day = (date: string): OperatingDay => {
  const { start, end } = agendaDay(date);
  return { start: +start, end: +end, opens: +start + OPENING_HOUR * 3600000, closes: +start + CLOSING_HOUR * 3600000 };
};
const interval = (start: number, end: number) => ({ start, end });
const first = day('2026-10-01');
const second = day('2026-10-02');
const hours = (from: number, to: number) => interval(first.start + from * 3600000, first.start + to * 3600000);

describe('dashboard interval union', () => {
  it.each([
    ['separated', [interval(1, 2), interval(3, 4)], [interval(1, 2), interval(3, 4)]],
    ['overlapping', [interval(1, 3), interval(2, 4)], [interval(1, 4)]],
    ['adjacent', [interval(1, 2), interval(2, 3)], [interval(1, 3)]],
    ['contained', [interval(1, 4), interval(2, 3)], [interval(1, 4)]],
    ['unordered', [interval(3, 4), interval(1, 3)], [interval(1, 4)]],
    ['empty', [interval(2, 2)], []],
  ])('%s', (_name, input, expected) => {
    const original = structuredClone(input);
    expect(unionIntervals(input)).toEqual(expected); expect(input).toEqual(original);
  });
});
describe('dashboard blocks clipped and united within operating days', () => {
  it.each([
    ['inside', [hours(10, 12)], 120], ['before opening', [hours(6, 7)], 0],
    ['after closing', [hours(22, 23)], 0], ['cross opening', [hours(7, 9)], 60],
    ['cross closing', [hours(20, 22)], 60], ['overlapping', [hours(10, 12), hours(11, 13)], 180],
    ['contained', [hours(10, 13), hours(11, 12)], 180], ['outside period', [interval(second.opens, second.closes)], 0],
  ])('%s', (_name, blocks, expected) => expect(blockedMinutes(blocks, first)).toBe(expected));
  it('clips a multi-day block separately on both days', () => {
    const blocks = [interval(first.start + 20 * 3600000, second.start + 9 * 3600000)];
    expect(blockedMinutes(blocks, first)).toBe(60); expect(blockedMinutes(blocks, second)).toBe(60);
  });
});
describe('dashboard available capacity', () => {
  it('active room without blocks has 780 minutes per day', () => expect(availableMinutes(true, first.start, [first], [])).toBe(780));
  it('two days have 1560 minutes', () => expect(availableMinutes(true, first.start, [first, second], [])).toBe(1560));
  it('creation during second business day contributes only that whole day', () => expect(availableMinutes(true, second.opens, [first, second], [])).toBe(780));
  it('a room created after the range has no capacity', () => expect(availableMinutes(true, second.end, [first, second], [])).toBe(0));
  it('overlapping and adjacent blocks do not double subtract', () => expect(availableMinutes(true, first.start, [first], [hours(10, 12), hours(11, 13), hours(13, 14)])).toBe(540));
  it('inactive capacity is zero and utilization is unknown', () => {
    const capacity = availableMinutes(false, first.start, [first, second], []);
    expect(capacity).toBe(0); expect(utilizationBp(120, capacity)).toBeNull();
  });
});
describe('dashboard booked minutes and utilization', () => {
  it.each([[390, 780, 5000], [585, 780, 7500], [1, 3, 3333], [2, 3, 6667], [900, 780, 11538]])('%i / %i = %i bp without clamp', (booked, capacity, expected) => expect(utilizationBp(booked, capacity)).toBe(expected));
  it('zero capacity yields null', () => expect(utilizationBp(0, 0)).toBeNull());
  it('clips reservations crossing opening and closing', () => {
    expect(bookedMinutes(hours(7, 9), [first])).toBe(60);
    expect(bookedMinutes(hours(20, 22), [first])).toBe(60);
  });
  it('retains real duration and clips multi-day intervals', () => {
    expect(bookedMinutes(interval(first.opens, first.opens + 45 * minute), [first])).toBe(45);
    expect(bookedMinutes(interval(first.closes - 30 * minute, second.opens + 30 * minute), [first, second])).toBe(60);
  });
});
describe('dashboard exact money', () => {
  it.each([['0.10', '0.20', '0.30'], ['150.10', '99.90', '250.00'], ['900719925474099.91', '0.10', '900719925474100.01']])('adds %s + %s exactly', (a, b, expected) => expect(formatCents(decimalCents(a) + decimalCents(b))).toBe(expected));
  it('confirmed refunds reduce net', () => expect(formatCents(decimalCents('250.00') - 3000n)).toBe('220.00'));
  it('formats negative and zero cents', () => { expect(formatCents(-5n)).toBe('-0.05'); expect(formatCents(0n)).toBe('0.00'); });
  it('rejects invalid decimal representations', () => { for (const value of ['', 'abc', '1.234']) expect(() => decimalCents(value)).toThrow(); });
});
describe('dashboard range validation', () => {
  const service = new DashboardService({} as never);
  it.each(['2026-02-30', '2026-13-01', '2026-1-01', 'bad'])('rejects %s', from => expect(() => service.range({ from, to: '2026-12-31' })).toThrow('Invalid calendar date'));
  it('rejects reversed range', () => expect(() => service.range({ from: '2026-10-02', to: '2026-10-01' })).toThrow('Invalid dashboard range'));
  it('accepts exactly 62 inclusive days', () => expect(service.range({ from: '2026-10-01', to: '2026-12-01' }).days).toBe(62));
  it('rejects 63 days', () => expect(() => service.range({ from: '2026-10-01', to: '2026-12-02' })).toThrow('Dashboard range too large'));
  it('handles month/year rollover and semi-open boundaries', () => {
    const range = service.range({ from: '2026-12-31', to: '2027-01-01' });
    expect(range.days).toBe(2); expect(range.start.toISOString()).toBe('2026-12-31T06:00:00.000Z');
    expect(range.end.toISOString()).toBe('2027-01-02T06:00:00.000Z');
  });
});
