import { api } from "./api";
import type { Room } from "./rooms";
import type { roomPayload } from "./room-form";

export async function getManagedRooms(signal: AbortSignal) {
  return (await api.get<Room[]>("/admin/rooms", { signal })).data;
}
export async function saveRoom(
  id: string | null,
  data: ReturnType<typeof roomPayload>,
) {
  if (id)
    return (await api.patch<Room>(`/rooms/${encodeURIComponent(id)}`, data))
      .data;
  return (await api.post<Room>("/rooms", data)).data;
}
export async function setRoomActive(id: string, active: boolean) {
  return (await api.patch<Room>(`/rooms/${encodeURIComponent(id)}`, { active }))
    .data;
}
