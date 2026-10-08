// Millisecond intervals are semi-open. Business-day boundaries are supplied by
// agendaDay() in the service, so these helpers have no timezone or Nest dependency.
export type Interval = { start: number; end: number };
export type OperatingDay = Interval & { opens: number; closes: number };

export function unionIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter(i => i.end > i.start)
    .map(i => ({ ...i })).sort((a, b) => a.start - b.start);
  const result: Interval[] = [];
  for (const interval of sorted) {
    const last = result.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else result.push(interval);
  }
  return result;
}

export function clipIntervals(intervals: Interval[], window: Interval): Interval[] {
  return intervals.map(i => ({ start: Math.max(i.start, window.start), end: Math.min(i.end, window.end) }))
    .filter(i => i.end > i.start);
}

export function blockedMinutes(blocks: Interval[], day: OperatingDay): number {
  return Math.floor(unionIntervals(clipIntervals(blocks, { start: day.opens, end: day.closes }))
    .reduce((sum, i) => sum + i.end - i.start, 0) / 60000);
}

export function availableMinutes(active: boolean, createdAt: number, days: OperatingDay[], blocks: Interval[]): number {
  if (!active) return 0;
  // Capacity starts on the creation business day, including that whole day.
  return days.filter(day => createdAt < day.end).reduce((sum, day) =>
    sum + Math.floor((day.closes - day.opens) / 60000) - blockedMinutes(blocks, day), 0);
}

export function bookedMinutes(reservation: Interval, days: OperatingDay[]): number {
  return Math.floor(days.reduce((sum, day) => sum + clipIntervals([reservation], { start: day.opens, end: day.closes })
    .reduce((duration, i) => duration + i.end - i.start, 0), 0) / 60000);
}

export function utilizationBp(booked: number, available: number): number | null {
  return available === 0 ? null : Math.round(booked * 10000 / available);
}

// Same exact-decimal/BigInt pattern as PaymentHistoryService. SQL aggregates are
// returned as text; neither decimal pesos nor SUM(integer) pass through Number.
export function decimalCents(text: string): bigint {
  const parts = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!parts) throw new Error('Invalid decimal amount');
  const cents = BigInt(parts[2]) * 100n + BigInt((parts[3] ?? '').padEnd(2, '0'));
  return parts[1] ? -cents : cents;
}

export function formatCents(cents: bigint): string {
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
