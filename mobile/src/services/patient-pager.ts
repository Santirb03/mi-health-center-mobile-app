import type { Patient, PatientPage } from "./patients";

export type QueryKind = "all" | "too_short" | "too_long" | "too_many_terms" | "search";
export function normalizeQuery(text: string): { kind: Exclude<QueryKind, "search"> } | { kind: "search"; q: string } {
  const q = text.trim().replace(/\s+/g, " ");
  if (!q) return { kind: "all" };
  if (q.length === 1) return { kind: "too_short" };
  if (q.length > 80) return { kind: "too_long" };
  if (q.split(" ").length > 4) return { kind: "too_many_terms" };
  return { kind: "search", q };
}
export interface PatientListState {
  items: Patient[];
  nextCursor: string | null;
  query: string;
  kind: QueryKind;
  loading: boolean;
  error: string | null;
}
export const queryMessage = (kind: QueryKind) => ({
  too_short: "Escribe al menos 2 caracteres para buscar.",
  too_long: "La búsqueda no puede superar 80 caracteres.",
  too_many_terms: "Utiliza como máximo cuatro palabras para buscar.",
  all: null, search: null,
})[kind];

export function createPatientPager(
  read: (q: string | undefined, cursor: string | null, signal: AbortSignal) => Promise<PatientPage>,
) {
  let state: PatientListState = { items: [], nextCursor: null, query: "", kind: "all", loading: false, error: null };
  let request: AbortController | undefined;
  let generation = 0;
  let disposed = false;
  let initialized = false;
  const listeners = new Set<() => void>();
  function update(next: PatientListState) {
    if (disposed) return;
    state = next;
    listeners.forEach(listener => listener());
  }
  function cancel() {
    generation++;
    request?.abort();
    request = undefined;
  }
  async function load() {
    if (disposed || request || !["all", "search"].includes(state.kind)) return;
    const previous = state;
    const current = generation;
    const controller = new AbortController();
    request = controller;
    update({ ...previous, loading: true, error: null });
    try {
      const page = await read(previous.query || undefined, previous.nextCursor, controller.signal);
      if (disposed || controller.signal.aborted || current !== generation) return;
      const items = new Map(previous.items.map(item => [item.id, item]));
      page.items.forEach(item => items.set(item.id, item));
      update({ ...previous, items: [...items.values()], nextCursor: page.nextCursor, loading: false, error: null });
    } catch {
      if (!disposed && !controller.signal.aborted && current === generation)
        update({ ...previous, loading: false, error: "No pudimos cargar tus pacientes. Intenta de nuevo." });
    } finally {
      if (request === controller) request = undefined;
    }
  }
  function setQuery(text: string, readNow = true): Promise<void> {
    const query = text.trim().replace(/\s+/g, " ");
    if (disposed || (initialized && query === state.query)) return Promise.resolve();
    initialized = true;
    const result = normalizeQuery(text);
    cancel();
    update({ items: [], nextCursor: null, query, kind: result.kind,
      loading: result.kind === "all" || result.kind === "search", error: null });
    return readNow ? load() : Promise.resolve();
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setQuery,
    reload() {
      if (disposed) return Promise.resolve();
      initialized = true;
      cancel();
      update({ ...state, items: [], nextCursor: null, error: null,
        loading: state.kind === "all" || state.kind === "search" });
      return load();
    },
    more: () => !disposed && state.nextCursor && !state.error ? load() : Promise.resolve(),
    retry: () => !disposed && state.error ? load() : Promise.resolve(),
    cancel() { cancel(); update({ ...state, loading: false }); },
    dispose() {
      cancel();
      update({ ...state, items: [], nextCursor: null, loading: false, error: null });
      disposed = true;
      listeners.clear();
    },
  };
}
