import type { AxiosRequestConfig } from "axios";
import { api, session } from "./api";

export interface Appointment {
  id: string;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  startTime: string;
  endTime: string;
  createdAt: string;
  updatedAt: string;
  patient: { id: string; firstName: string; lastName: string };
  reservation: { id: string; status: string; startTime: string; endTime: string;
    room: { id: string; name: string } } | null;
  needsRoomReview: boolean;
}
export interface AppointmentPage { items: Appointment[]; nextCursor: string | null }
export interface AppointmentCalendar { items: Appointment[]; truncated: boolean }
export interface AppointmentTimes { reservationId: string; startTime: string; endTime: string }
export interface AppointmentPayload extends AppointmentTimes { patientId: string }
function config(signal?: AbortSignal): AxiosRequestConfig & { _sessionVersion: number } {
  return { signal, _sessionVersion: session.getVersion() };
}
export async function getAppointmentCalendar(from: string, to: string, signal: AbortSignal) {
  return (await api.get<AppointmentCalendar>("/appointments/calendar", { ...config(signal), params: { from, to } })).data;
}
export async function getAppointmentPage(patientId: string | undefined, cursor: string | null, signal: AbortSignal) {
  return (await api.get<AppointmentPage>("/appointments/page", { ...config(signal),
    params: { ...(patientId ? { patientId } : {}), ...(cursor ? { cursor } : {}) } })).data;
}
export async function getAppointment(id: string, signal: AbortSignal) {
  return (await api.get<Appointment>(`/appointments/${encodeURIComponent(id)}`, config(signal))).data;
}
export async function createAppointment(payload: AppointmentPayload) {
  return (await api.post<Appointment>("/appointments", payload, config())).data;
}
export async function updateAppointment(id: string, payload: AppointmentTimes) {
  return (await api.patch<Appointment>(`/appointments/${encodeURIComponent(id)}`, payload, config())).data;
}
export async function cancelAppointment(id: string) {
  return (await api.patch<Appointment>(`/appointments/${encodeURIComponent(id)}/cancel`, undefined, config())).data;
}
export async function completeAppointment(id: string) {
  return (await api.patch<Appointment>(`/appointments/${encodeURIComponent(id)}/complete`, undefined, config())).data;
}
