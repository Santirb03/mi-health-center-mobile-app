import type { PaymentSummary } from "../components/refund-status";
import type { Reservation } from "./reservations";
import { dayLongLabel, reservationDay } from "./calendar";
import { formatTime } from "./booking";

export interface PaymentHistoryItem extends PaymentSummary {
  id: string;
  reservationId: string;
  amount: string;
  status: "PAID" | "REFUNDED";
  paidAt: string | null;
  createdAt: string;
  refunds: NonNullable<PaymentSummary["refunds"]>;
  refundSync: NonNullable<PaymentSummary["refundSync"]> | null;
  reservation: {
    id: string;
    startTime: string;
    endTime: string;
    status: Reservation["status"];
    room: { id: string; name: string };
  };
}

export interface PaymentHistoryTotals {
  paid: string;
  refunded: string;
  net: string;
}

export interface PaymentHistoryPage {
  items: PaymentHistoryItem[];
  nextCursor: string | null;
  totals: PaymentHistoryTotals | null;
}

type State = PaymentHistoryPage & { loading: boolean; error: string | null };
const empty = (): State => ({
  items: [], nextCursor: null, totals: null, loading: true, error: null,
});

export function createPaymentHistoryPager(
  read: (cursor: string | null, signal: AbortSignal) => Promise<PaymentHistoryPage>,
) {
  let state = empty();
  let request: AbortController | undefined;
  const listeners = new Set<() => void>();
  function update(next: State) {
    state = next;
    listeners.forEach((listener) => listener());
  }
  async function load(reset: boolean) {
    if (!reset && (request || !state.nextCursor)) return;
    const previous = reset ? empty() : state;
    request?.abort();
    const controller = new AbortController();
    request = controller;
    update({ ...previous, loading: true, error: null });
    try {
      const page = await read(previous.nextCursor, controller.signal);
      if (controller.signal.aborted) return;
      const items = new Map(previous.items.map((item) => [item.id, item]));
      page.items.forEach((item) => items.set(item.id, item));
      update({
        items: [...items.values()], nextCursor: page.nextCursor,
        totals: reset ? page.totals : previous.totals,
        loading: false, error: null,
      });
    } catch {
      if (!controller.signal.aborted) update({
        ...previous, loading: false,
        error: "No pudimos cargar tus pagos. Intenta de nuevo.",
      });
    } finally {
      if (request === controller) request = undefined;
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    reload: () => load(true),
    more: () => state.error ? Promise.resolve() : load(false),
    retry: () => state.error ? load(state.items.length === 0) : Promise.resolve(),
    dispose() { request?.abort(); request = undefined; },
  };
}

export function paymentStatusText(status: PaymentHistoryItem["status"]) {
  return status === "PAID" ? "Pagado" : "Reembolsado";
}

export function paymentDateLabel(paidAt: string | null) {
  return paidAt === null ? "Fecha de pago no registrada"
    : `${dayLongLabel(reservationDay(paidAt))} · ${formatTime(paidAt)}`;
}

export function reservationNote(status: Reservation["status"]) {
  if (status === "CANCELLED") return "La reserva fue cancelada.";
  if (status === "EXPIRED") return "La reserva venció.";
  return null;
}
