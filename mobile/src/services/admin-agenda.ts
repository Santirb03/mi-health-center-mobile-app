import { api } from "./api";
import type { Reservation } from "./reservations";

export type AgendaStatus = Reservation["status"];
export const agendaStatusLabels: Record<AgendaStatus, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmada",
  CANCELLED: "Cancelada",
  COMPLETED: "Completada",
  EXPIRED: "Vencida",
};
export interface AgendaFilters {
  date: string;
  roomId?: string;
  status?: AgendaStatus;
  page: number;
}
export interface AgendaRoom {
  id: string;
  name: string;
  active: boolean;
}
export interface AgendaItem {
  id: string;
  startTime: string;
  endTime: string;
  totalPrice: string;
  status: AgendaStatus;
  displayStatus: AgendaStatus;
  expiresAt: string | null;
  room: AgendaRoom;
  doctor: { firstName: string; lastName: string };
  payment: { status: "PENDING" | "PAID" | "FAILED" | "REFUNDED" } | null;
}
export interface AgendaPage {
  items: AgendaItem[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}
export async function getCurrentUser(signal?: AbortSignal) {
  return (
    await api.get<{ id: string; role: "ADMIN" | "DOCTOR" }>("/auth/me", {
      signal,
    })
  ).data;
}
export async function getAgenda(filters: AgendaFilters, signal: AbortSignal) {
  return (
    await api.get<AgendaPage>("/admin/agenda", { params: filters, signal })
  ).data;
}
export async function getAgendaRooms(signal: AbortSignal) {
  return (await api.get<AgendaRoom[]>("/admin/rooms", { signal })).data;
}
