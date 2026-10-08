import { businessDate, shiftDate } from "./booking";
import { dayLongLabel, weekRangeLabel, weekStart } from "./calendar";

export type PeriodKind = "day" | "week" | "month" | "custom";
export interface DashboardRoom {
  roomId: string;
  name: string;
  active: boolean;
  bookedMinutes: number;
  availableMinutes: number;
  utilizationBp: number | null;
  paid: string;
  net: string;
}
export interface DashboardResponse {
  range: { from: string; to: string; days: number };
  reservations: { confirmed: number; completed: number; cancelled: number; expired: number; pendingActive: number };
  cancellations: { cancelled: number; cancelledWithPayment: number };
  revenue: { paid: string; refunded: string; net: string };
  rooms: DashboardRoom[];
  generatedAt: string;
}

const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function validDate(date: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const value = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date ? value : null;
}
function dateValue(date: string): Date {
  const value = validDate(date);
  if (!value) throw new Error("Invalid business date");
  return value;
}

export function periodRange(kind: PeriodKind, anchor: string): { from: string; to: string } {
  dateValue(anchor);
  if (kind === "custom") throw new Error("Custom range requires explicit from and to dates");
  if (kind === "day") return { from: anchor, to: anchor };
  if (kind === "week") {
    const from = weekStart(anchor);
    return { from, to: shiftDate(from, 6) };
  }
  const first = `${anchor.slice(0, 7)}-01`;
  const last = dateValue(first);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  return { from: first, to: last.toISOString().slice(0, 10) };
}

export function shiftAnchor(kind: PeriodKind, anchor: string, delta: number): string {
  const value = dateValue(anchor);
  if (kind === "custom") return anchor;
  if (kind === "day" || kind === "week") return shiftDate(anchor, delta * (kind === "week" ? 7 : 1));
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + delta);
  return value.toISOString().slice(0, 10);
}

export function periodLabel(kind: PeriodKind, anchor: string): string {
  const value = dateValue(anchor);
  if (kind === "day") return anchor === businessDate() ? "Hoy" : dayLongLabel(anchor);
  if (kind === "week") return weekRangeLabel(weekStart(anchor));
  if (kind === "custom") return "Personalizado";
  return `${months[value.getUTCMonth()]} de ${value.getUTCFullYear()}`;
}

export function daysInclusive(from: string, to: string): number {
  return (dateValue(to).getTime() - dateValue(from).getTime()) / 86400000 + 1;
}

export function validateCustomRange(from: string, to: string): string | null {
  if (!validDate(from) || !validDate(to)) return "Selecciona fechas válidas.";
  const days = daysInclusive(from, to);
  if (days < 1) return "La fecha final no puede ser anterior a la inicial.";
  if (days > 62) return "El periodo máximo es de 62 días.";
  return null;
}

export function formatBp(bp: number | null): string {
  if (bp === null) return "—";
  const tenths = Math.round(bp / 10);
  return `${Math.floor(tenths / 10)}.${tenths % 10} %`;
}

export function cancellationRateBp({ confirmed, completed, cancelled }: Pick<DashboardResponse["reservations"], "confirmed" | "completed" | "cancelled">): number | null {
  const total = confirmed + completed + cancelled;
  return total === 0 ? null : Math.round(cancelled * 10000 / total);
}

export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (!hours) return `${remaining} min`;
  return `${hours} h${remaining ? ` ${remaining} min` : ""}`;
}

export function overallUtilization(rooms: DashboardRoom[]) {
  const eligible = rooms.filter(room => room.active && room.availableMinutes > 0);
  const bookedMinutes = eligible.reduce((sum, room) => sum + room.bookedMinutes, 0);
  const availableMinutes = eligible.reduce((sum, room) => sum + room.availableMinutes, 0);
  return { bookedMinutes, availableMinutes, bp: availableMinutes === 0 ? null : Math.round(bookedMinutes * 10000 / availableMinutes) };
}

// Receipt amountToCents only accepts nonnegative safe-number amounts. Aggregate
// net values can be negative or larger, so ranking uses signed BigInt cents.
function netCents(text: string): bigint {
  const parts = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!parts) throw new Error("Invalid decimal amount");
  const cents = BigInt(parts[2]) * 100n + BigInt((parts[3] ?? "").padEnd(2, "0"));
  return parts[1] ? -cents : cents;
}
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function rankRooms(rooms: DashboardRoom[], by: "utilization" | "net"): DashboardRoom[] {
  const cents = by === "net" ? new Map(rooms.map(room => [room, netCents(room.net)])) : null;
  return [...rooms].sort((a, b) => {
    let rank = 0;
    if (by === "utilization") {
      if (a.utilizationBp === null && b.utilizationBp !== null) rank = 1;
      else if (b.utilizationBp === null && a.utilizationBp !== null) rank = -1;
      else if (a.utilizationBp !== null && b.utilizationBp !== null) rank = b.utilizationBp - a.utilizationBp;
    } else {
      const left = cents!.get(a)!, right = cents!.get(b)!;
      rank = left > right ? -1 : left < right ? 1 : 0;
    }
    return rank || compareText(a.name, b.name) || compareText(a.roomId, b.roomId);
  });
}
