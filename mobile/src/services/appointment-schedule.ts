import type { Appointment, AppointmentCalendar, AppointmentPage } from "./appointments";
import type { CalendarResponse, Reservation } from "./reservations";
import { appointmentInstant } from "./appointment-form";
import { shiftDate } from "./booking";
import { createPatientPager } from "./patient-pager";

export const appointmentLabels = { SCHEDULED: "Programada", COMPLETED: "Completada", CANCELLED: "Cancelada" };
export const truncationMessage = "Hay más citas de las que esta vista puede mostrar. Consulta el historial para ver más resultados.";
export const cancelMessage = "Cancelar esta cita no cancela la reserva del consultorio ni genera un reembolso.";
export function roomDescription(appointment: Appointment) {
  return appointment.reservation?.room.name ?? "Sin reserva vinculada";
}
export function roomWarning(appointment: Appointment) {
  return appointment.needsRoomReview ? "Revisa el consultorio: la cita no tiene una reserva confirmada vinculada." : null;
}
export function appointmentActions(appointment: Appointment, now: number) {
  const scheduled = appointment.status === "SCHEDULED";
  return { cancel: scheduled, reschedule: scheduled && now < Date.parse(appointment.startTime),
    complete: scheduled && now >= Date.parse(appointment.startTime) };
}
export function calendarMessage(data: AppointmentCalendar | null, loading: boolean, error: string | null) {
  if (loading || error || !data) return null;
  if (data.truncated) return truncationMessage;
  return data.items.length ? null : "No tienes citas para este día.";
}
export function appointmentFailure(status: number | undefined, message: unknown): string | null {
  if (status === 404) return "Esta cita ya no está disponible.";
  if (status !== 409) return null;
  if (message === "Appointment overlaps another appointment") return "Este horario se superpone con otra cita. Elige otro horario.";
  if (message === "Reservation must be confirmed" || message === "Reservation changed; retry appointment")
    return "La reserva cambió o ya no está confirmada. Actualiza y selecciona otra reserva.";
  return "La cita cambió o esta acción ya no está disponible. Actualiza para revisar su estado.";
}
export function createAppointmentPager(read: (patientId: string | undefined, cursor: string | null, signal: AbortSignal) => Promise<AppointmentPage>) {
  // Reuse the existing abort/generation, deduplication and retry lifecycle. IDs are
  // valid search keys (UUIDs); the query is sent as patientId, never as patient text.
  const pager = createPatientPager<Appointment>(read, "No pudimos cargar el historial de citas. Intenta de nuevo.");
  return { ...pager, setPatient: (patientId: string | null) => pager.setQuery(patientId ?? "") };
}
export async function confirmedReservationsForDay(
  date: string, signal: AbortSignal,
  calendar: (from: string, to: string, signal: AbortSignal) => Promise<CalendarResponse>,
  page: (cursor: string | null, signal: AbortSignal) => Promise<{ items: Reservation[]; nextCursor: string | null }>,
): Promise<Reservation[]> {
  const start = appointmentInstant(date, "00:00"), end = start && appointmentInstant(shiftDate(date, 1), "00:00");
  if (!start || !end) return [];
  const result = await calendar(date, date, signal);
  if (signal.aborted) throw new Error("Cancelled");
  const inDay = (item: Reservation) => item.status === "CONFIRMED" && Date.parse(item.startTime) < Date.parse(end)
    && Date.parse(item.endTime) > Date.parse(start);
  if (!result.truncated) return result.items.filter(inDay);
  // The confirmed endpoint is owned, ordered startTime ASC and uncapped by date.
  // Follow every needed page; no 50-candidate limit and no partial success on error.
  const items = new Map<string, Reservation>();
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    if (signal.aborted) throw new Error("Cancelled");
    const result = await page(cursor, signal);
    if (signal.aborted) throw new Error("Cancelled");
    result.items.filter(inDay).forEach(item => items.set(item.id, item));
    if (result.items.some(item => Date.parse(item.startTime) >= Date.parse(end)) || !result.nextCursor) break;
    if (seen.has(result.nextCursor)) throw new Error("Reservation cursor did not advance");
    seen.add(result.nextCursor); cursor = result.nextCursor;
  } while (true);
  return [...items.values()];
}
