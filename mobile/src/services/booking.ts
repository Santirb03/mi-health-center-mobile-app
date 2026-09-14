import type { Slot } from "./rooms";
import type { Reservation, ReservationInput } from "./reservations";

export const BUSINESS_TIME_ZONE = "America/Mexico_City";

export function businessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: BUSINESS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function money(value: string | number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(Number(value));
}

export function selectable(slot: Slot, now = Date.now()): boolean {
  return (
    slot.available && !slot.blocked && Date.parse(slot.startDateTime) > now
  );
}

export function selectedRange(
  slots: Slot[],
  start: number,
  end: number,
  now = Date.now(),
): Slot[] {
  if (start < 0 || end < start || end >= slots.length) return [];
  const range = slots.slice(start, end + 1);
  return range.every(
    (slot, index) =>
      selectable(slot, now) &&
      (index === 0 || range[index - 1].endDateTime === slot.startDateTime),
  )
    ? range
    : [];
}

export function reservationLabel(
  reservation: Reservation,
  now = Date.now(),
): string {
  if (reservation.status === "PENDING") {
    return !reservation.expiresAt || Date.parse(reservation.expiresAt) <= now
      ? "Retención vencida · sin confirmar"
      : "Pendiente de pago · sin confirmar";
  }
  return {
    CONFIRMED: "Confirmada",
    CANCELLED: "Cancelada",
    COMPLETED: "Completada",
    EXPIRED: "Vencida",
  }[reservation.status];
}

export function matchingReservation(
  items: Reservation[],
  input: ReservationInput,
  now = Date.now(),
) {
  return items.find(
    (item) =>
      item.roomId === input.roomId &&
      Date.parse(item.startTime) === Date.parse(input.startTime) &&
      Date.parse(item.endTime) === Date.parse(input.endTime) &&
      (item.status === "CONFIRMED" ||
        (item.status === "PENDING" &&
          !!item.expiresAt &&
          Date.parse(item.expiresAt) > now)),
  );
}
