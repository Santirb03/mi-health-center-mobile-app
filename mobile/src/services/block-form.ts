import type { BlockInput, RoomBlock } from "./room-blocks";

export function blockErrors(
  date: string,
  start: string,
  end: string,
  reason: string,
  now = Date.now(),
): Partial<Record<'date' | 'start' | 'end' | 'reason', string>> {
  const errors: Partial<Record<'date' | 'start' | 'end' | 'reason', string>> = {};
  const day = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== date
  )
    errors.date = "Selecciona una fecha válida en la agenda.";
  if (!/^\d{1,2}$/.test(start) || Number(start) < 8 || Number(start) > 20)
    errors.start = "Usa una hora completa entre 08 y 20.";
  if (!/^\d{1,2}$/.test(end) || Number(end) < 9 || Number(end) > 21)
    errors.end = "Usa una hora completa entre 09 y 21.";
  if (!errors.start && !errors.end && Number(end) <= Number(start))
    errors.end = "La hora de fin debe ser posterior al inicio.";
  if (!errors.date && !errors.start
      && Date.parse(`${date}T${start.padStart(2, '0')}:00:00-06:00`) <= now)
    errors.start = "Selecciona una hora de inicio futura.";
  if (reason.trim().length > 500) errors.reason = "El motivo admite hasta 500 caracteres.";
  return errors;
}

export function blockInput(date: string, start: string, end: string, reason: string, now = Date.now()): BlockInput {
  const error = Object.values(blockErrors(date, start, end, reason, now))[0];
  if (error) throw new Error(error);
  const startTime = new Date(
    `${date}T${start.padStart(2, "0")}:00:00-06:00`,
  ).toISOString();
  const endTime = new Date(
    `${date}T${end.padStart(2, "0")}:00:00-06:00`,
  ).toISOString();
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
