import { api } from './api';
export interface Notice { id: string; reservationId: string; title: string; body: string; createdAt: string; readAt: string | null }
export async function getNotifications(signal?: AbortSignal) {
  return (await api.get<{ items: Notice[]; unreadCount: number }>('/notifications', { signal })).data;
}
export async function markRead(id: string) { await api.patch(`/notifications/${encodeURIComponent(id)}/read`); }
export async function markAllRead() { await api.patch('/notifications/read-all'); }
