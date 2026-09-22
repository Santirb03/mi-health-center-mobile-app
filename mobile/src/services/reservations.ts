import { api } from "./api";
import type { Room } from "./rooms";
import type { ReservationPage, ReservationSection } from './reservation-pager';

export interface Reservation {
  id: string;
  roomId: string;
  startTime: string;
  endTime: string;
  totalPrice: string;
  status: "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "EXPIRED";
  expiresAt: string | null;
  room?: Room;
}

export interface ReservationInput {
  roomId: string;
  startTime: string;
  endTime: string;
}

export async function getReservations(signal?: AbortSignal) {
  return (await api.get<Reservation[]>("/reservations", { signal })).data;
}

export async function getReservationPage(group: ReservationSection, cursor: string | null, signal: AbortSignal) {
  return (await api.get<ReservationPage>('/reservations/page', {
    params: { group, ...(cursor ? { cursor } : {}) }, signal,
  })).data;
}

export async function getReservation(id: string, signal?: AbortSignal) {
  return (
    await api.get<Reservation>(`/reservations/${encodeURIComponent(id)}`, {
      signal,
    })
  ).data;
}

export async function createReservation(input: ReservationInput) {
  // Never retry a POST after a timeout: the server may have committed it.
  return (await api.post<Reservation>("/reservations", input)).data;
}
