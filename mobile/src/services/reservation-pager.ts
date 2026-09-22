import type { Reservation } from './reservations';

export const reservationSections = ['pending', 'confirmed', 'history'] as const;
export type ReservationSection = typeof reservationSections[number];
export interface ReservationPage { items: Reservation[]; nextCursor: string | null }
type Section = ReservationPage & { loading: boolean; error: string | null };
type State = Record<ReservationSection, Section>;
const empty = (): Section => ({ items: [], nextCursor: null, loading: true, error: null });

// Independent of React: aborted refreshes, retries and duplicate taps can be tested.
export function createReservationPager(
  read: (group: ReservationSection, cursor: string | null, signal: AbortSignal) => Promise<ReservationPage>,
) {
  let state: State = { pending: empty(), confirmed: empty(), history: empty() };
  const listeners = new Set<() => void>();
  const requests = new Map<ReservationSection, AbortController>();
  function update(group: ReservationSection, section: Section) {
    state = { ...state, [group]: section };
    listeners.forEach((listener) => listener());
  }
  async function load(group: ReservationSection, reset = false) {
    if (requests.has(group) && !reset) return;
    const previous = reset ? empty() : state[group];
    if (!reset && !previous.nextCursor && !previous.error) return;
    requests.get(group)?.abort();
    const controller = new AbortController();
    requests.set(group, controller);
    update(group, { ...previous, loading: true, error: null });
    try {
      const page = await read(group, previous.nextCursor, controller.signal);
      if (controller.signal.aborted) return;
      const items = new Map(previous.items.map((item) => [item.id, item]));
      page.items.forEach((item) => items.set(item.id, item));
      update(group, { items: [...items.values()], nextCursor: page.nextCursor, loading: false, error: null });
    } catch {
      if (!controller.signal.aborted) update(group, {
        ...previous, loading: false, error: 'No pudimos cargar estas reservas. Intenta de nuevo.',
      });
    } finally {
      if (requests.get(group) === controller) requests.delete(group);
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reload: () => Promise.all(reservationSections.map((group) => load(group, true))),
    more: (group: ReservationSection) => load(group),
    dispose() { requests.forEach((controller) => controller.abort()); requests.clear(); },
  };
}
