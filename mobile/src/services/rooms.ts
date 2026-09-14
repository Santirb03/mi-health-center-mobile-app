import { api } from "./api";

export interface Room {
  id: string;
  name: string;
  description: string | null;
  pricePerHour: string;
  active: boolean;
}

export interface Slot {
  startTime: string;
  endTime: string;
  startDateTime: string;
  endDateTime: string;
  available: boolean;
  blocked: boolean;
}

export interface Availability {
  roomId: string;
  date: string;
  timeZone: string;
  slots: Slot[];
}

export async function getRoom(id: string, signal?: AbortSignal) {
  return (await api.get<Room>(`/rooms/${encodeURIComponent(id)}`, { signal }))
    .data;
}

export async function getAvailability(
  id: string,
  date: string,
  signal?: AbortSignal,
) {
  return (
    await api.get<Availability>(
      `/rooms/${encodeURIComponent(id)}/availability`,
      {
        params: { date },
        signal,
      },
    )
  ).data;
}
