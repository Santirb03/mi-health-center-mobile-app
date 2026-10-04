import { businessDate, shiftDate } from "./booking";
import type { Reservation } from "./reservations";

const shortDays = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const longDays = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];
const months = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const noon = (date: string) => new Date(`${date}T12:00:00Z`);

export function weekStart(date: string): string {
  return shiftDate(date, -((noon(date).getUTCDay() + 6) % 7));
}

export function weekDates(start: string): string[] {
  return Array.from({ length: 7 }, (_, index) => shiftDate(start, index));
}

export function calendarRange(start: string) {
  return { from: start, to: shiftDate(start, 6) };
}

export function reservationDay(iso: string): string {
  return businessDate(new Date(iso));
}

export function groupByDay(
  items: Reservation[],
  dates: string[],
): Record<string, Reservation[]> {
  const groups: Record<string, Reservation[]> = Object.fromEntries(
    dates.map((date) => [date, []]),
  );
  for (const item of new Map(items.map((item) => [item.id, item])).values()) {
    const start = Date.parse(item.startTime);
    const end = Date.parse(item.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      continue;
    const firstDay = reservationDay(item.startTime);
    // The last millisecond inside [startTime, endTime) keeps midnight exclusive.
    const lastDay = reservationDay(new Date(end - 1).toISOString());
    for (const date of Object.keys(groups)) {
      if (date >= firstDay && date <= lastDay) groups[date].push(item);
    }
  }
  for (const group of Object.values(groups)) {
    group.sort(
      (a, b) =>
        Date.parse(a.startTime) - Date.parse(b.startTime) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  }
  return groups;
}

export function dayShortLabel(date: string): string {
  return shortDays[noon(date).getUTCDay()];
}

export function dayNumber(date: string): number {
  return noon(date).getUTCDate();
}

export function dayLongLabel(date: string): string {
  const value = noon(date);
  return `${longDays[value.getUTCDay()]} ${value.getUTCDate()} de ${months[value.getUTCMonth()]}`;
}

export function weekRangeLabel(start: string): string {
  const from = noon(start);
  const to = noon(shiftDate(start, 6));
  const first = `${from.getUTCDate()} de ${months[from.getUTCMonth()]}`;
  const last = `${to.getUTCDate()} de ${months[to.getUTCMonth()]} de ${to.getUTCFullYear()}`;
  if (from.getUTCFullYear() !== to.getUTCFullYear())
    return `${first} de ${from.getUTCFullYear()} – ${last}`;
  if (from.getUTCMonth() !== to.getUTCMonth()) return `${first} – ${last}`;
  return `${from.getUTCDate()} – ${last}`;
}

export function defaultSelectedDate(start: string, today: string): string {
  return today >= start && today <= shiftDate(start, 6) ? today : start;
}
