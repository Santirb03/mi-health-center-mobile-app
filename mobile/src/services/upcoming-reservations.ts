import type { Reservation } from './reservations';

export async function collectConfirmed(
  read: (cursor: string | null) => Promise<{ items: Reservation[]; nextCursor: string | null }>,
  limit = 50,
  maxPages = 5,
): Promise<Reservation[]> {
  if (!Number.isInteger(limit) || limit < 0 || !Number.isInteger(maxPages) || maxPages < 0) {
    throw new Error('Invalid collection limits');
  }
  const items = new Map<string, Reservation>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < maxPages && items.size < limit; page++) {
    const result = await read(cursor);
    for (const item of result.items) {
      if (!items.has(item.id)) items.set(item.id, item);
    }
    if (result.nextCursor === null) break;
    if (cursors.has(result.nextCursor)) throw new Error('Reservation cursor did not advance');
    cursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  return [...items.values()].slice(0, limit);
}
