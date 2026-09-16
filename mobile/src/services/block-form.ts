import type { BlockInput, RoomBlock } from "./room-blocks";

export function blockInput(
  date: string,
  start: string,
  end: string,
  reason: string,
  now = Date.now(),
): BlockInput {
  const day = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== date
  )
    throw new Error("Selecciona una fecha válida en la agenda.");
  if (
    !/^\d{1,2}$/.test(start) ||
    !/^\d{1,2}$/.test(end) ||
    Number(start) < 8 ||
    Number(end) > 21 ||
    Number(end) <= Number(start)
  )
    throw new Error(
      "Usa horas completas entre 08 y 21, con fin posterior al inicio.",
    );
  const startTime = new Date(
    `${date}T${start.padStart(2, "0")}:00:00-06:00`,
  ).toISOString();
  const endTime = new Date(
    `${date}T${end.padStart(2, "0")}:00:00-06:00`,
  ).toISOString();
  if (Date.parse(startTime) <= now)
    throw new Error("Selecciona una hora de inicio futura.");
  return {
    startTime,
    endTime,
    ...(reason.trim() ? { reason: reason.trim() } : {}),
  };
}

export function blocksOnDate(blocks: RoomBlock[], date: string) {
  const start = Date.parse(`${date}T00:00:00-06:00`);
  const end = start + 86400000;
  return blocks
    .filter(
      (block) =>
        Date.parse(block.startTime) < end && Date.parse(block.endTime) > start,
    )
    .sort(
      (a, b) =>
        Date.parse(a.startTime) - Date.parse(b.startTime) ||
        a.id.localeCompare(b.id),
    );
}
