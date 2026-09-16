import { api } from "./api";

export interface RoomBlock {
  id: string;
  roomId: string;
  startTime: string;
  endTime: string;
  reason: string | null;
}
export interface BlockInput {
  startTime: string;
  endTime: string;
  reason?: string;
}

export async function getRoomBlocks(roomId: string, signal: AbortSignal) {
  return (
    await api.get<RoomBlock[]>(`/rooms/${encodeURIComponent(roomId)}/blocks`, {
      signal,
    })
  ).data;
}
export async function createRoomBlock(roomId: string, input: BlockInput) {
  return (
    await api.post<RoomBlock>(
      `/rooms/${encodeURIComponent(roomId)}/blocks`,
      input,
    )
  ).data;
}
export async function removeRoomBlock(roomId: string, blockId: string) {
  await api.delete(
    `/rooms/${encodeURIComponent(roomId)}/blocks/${encodeURIComponent(blockId)}`,
  );
}
