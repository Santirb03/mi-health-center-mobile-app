import type { Appointment, AppointmentPayload, AppointmentTimes } from "./appointments";
import type { Reservation } from "./reservations";
import { businessDate, formatTime } from "./booking";

export interface AppointmentForm { patientId: string; reservationId: string; date: string; start: string; end: string }
export type AppointmentErrors = Partial<Record<keyof AppointmentForm, string>>;
export function appointmentInstant(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const noon = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(noon.getTime()) || noon.toISOString().slice(0, 10) !== date) return null;
  // Same fixed business offset as the backend's agendaDay; never the device zone.
  return new Date(`${date}T${time}:00.000-06:00`).toISOString();
}
export function containsAppointment(reservation: Pick<Reservation, "status" | "startTime" | "endTime">, startTime: string, endTime: string) {
  const start = Date.parse(startTime), end = Date.parse(endTime);
  return reservation.status === "CONFIRMED" && end > start && start >= Date.parse(reservation.startTime)
    && end <= Date.parse(reservation.endTime);
}
export function appointmentErrors(form: AppointmentForm, reservation: Reservation | undefined, now = Date.now()): AppointmentErrors {
  const errors: AppointmentErrors = {};
  if (!form.patientId) errors.patientId = "Selecciona un paciente.";
  if (!form.reservationId) errors.reservationId = "Selecciona una reserva confirmada.";
  const start = appointmentInstant(form.date, form.start), end = appointmentInstant(form.date, form.end);
  if (!appointmentInstant(form.date, "00:00")) errors.date = "Usa una fecha válida: AAAA-MM-DD.";
  if (!start) errors.start = "Usa una hora válida: HH:mm.";
  else if (Number(form.start.slice(-2)) % 5) errors.start = "El inicio debe ser múltiplo de cinco minutos.";
  else if (Date.parse(start) <= now) errors.start = "La cita debe comenzar en el futuro.";
  if (!end) errors.end = "Usa una hora válida: HH:mm.";
  else if (Number(form.end.slice(-2)) % 5) errors.end = "El fin debe ser múltiplo de cinco minutos.";
  if (start && end) {
    const minutes = (Date.parse(end) - Date.parse(start)) / 60000;
    if (minutes < 15 || minutes > 240) errors.end = "La duración debe ser de 15 a 240 minutos, con fin posterior al inicio.";
    if (form.reservationId && (!reservation || !containsAppointment(reservation, start, end)))
      errors.reservationId = "Selecciona una reserva confirmada que contenga todo el horario.";
  }
  return errors;
}
export function appointmentPayload(form: AppointmentForm): AppointmentPayload {
  return { patientId: form.patientId, ...appointmentPatch(form) };
}
export function appointmentPatch(form: AppointmentForm): AppointmentTimes {
  const startTime = appointmentInstant(form.date, form.start), endTime = appointmentInstant(form.date, form.end);
  if (!startTime || !endTime) throw new Error("Invalid appointment time");
  return { reservationId: form.reservationId, startTime, endTime };
}
export function formFromAppointment(appointment: Appointment): AppointmentForm {
  return { patientId: appointment.patient.id, reservationId: appointment.reservation?.id ?? "",
    date: businessDate(new Date(appointment.startTime)), start: formatTime(appointment.startTime), end: formatTime(appointment.endTime) };
}
export function appointmentServerErrors(messages: unknown): { fields: AppointmentErrors; general: string | null } {
  const fields: AppointmentErrors = {};
  const hints: AppointmentErrors = { patientId: "Selecciona un paciente válido.", reservationId: "Revisa la reserva seleccionada.",
    start: "Revisa el inicio: fecha futura y múltiplo de cinco minutos.", end: "Revisa el fin y la duración (15 a 240 minutos)." };
  let unknown = false;
  const list = Array.isArray(messages) ? messages : typeof messages === "string" ? [messages] : [];
  for (const message of list) {
    const field = typeof message !== "string" ? undefined
      : message.startsWith("patientId ") ? "patientId" : message.startsWith("reservationId ") || message === "Reservation required for rescheduling"
        || message === "Appointment must be within reservation" ? "reservationId"
      : message.startsWith("startTime ") || message === "Appointment must start in the future" ? "start"
      : message.startsWith("endTime ") || message === "Appointment duration must be between 15 and 240 minutes" ? "end" : undefined;
    if (message === "Appointment times must use five-minute precision" || message === "Invalid appointment time; explicit timezone required" || message === "Invalid appointment time") {
      fields.start = hints.start; fields.end = hints.end;
    } else if (field) fields[field] = hints[field];
    else unknown = true;
  }
  return { fields, general: unknown || !list.length ? "No pudimos guardar la cita. Revisa los datos e intenta de nuevo." : null };
}
