import type { Reservation } from "./reservations";

export interface PaymentIntentResponse {
  clientSecret: string;
  paymentIntentId: string;
  expiresAt: string;
}
type SheetResult = { error?: { code: string } };
export type CheckoutResult =
  "confirmed" | "pending" | "cancelled" | "failed" | "expired" | "unavailable";
export type CheckoutPhase = "preparing" | "paying" | "confirming";

export function canPay(reservation: Reservation, now = Date.now()) {
  return (
    reservation.status === "PENDING" &&
    !!reservation.expiresAt &&
    Date.parse(reservation.expiresAt) > now
  );
}

export function createCheckout(deps: {
  read(id: string, signal: AbortSignal): Promise<Reservation>;
  createIntent(id: string, signal: AbortSignal): Promise<PaymentIntentResponse>;
  initialize(secret: string, id: string): Promise<SheetResult>;
  present(): Promise<SheetResult>;
  current(): boolean;
  phase(value: CheckoutPhase): void;
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}) {
  let flight: Promise<CheckoutResult> | null = null;

  async function execute(
    id: string,
    signal: AbortSignal,
  ): Promise<CheckoutResult> {
    function check() {
      if (signal.aborted || !deps.current())
        throw new Error("Checkout no longer active");
    }
    check();
    deps.phase("preparing");
    const reservation = await deps.read(id, signal);
    check();
    if (reservation.status === "CONFIRMED") return "confirmed";
    if (!canPay(reservation, deps.now()))
      return reservation.status === "PENDING" ||
        reservation.status === "EXPIRED"
        ? "expired"
        : "unavailable";
    const intent = await deps.createIntent(id, signal);
    check();
    if (!intent.clientSecret || !intent.paymentIntentId)
      throw new Error("Invalid payment response");
    if (!(Date.parse(intent.expiresAt) > deps.now())) return "expired";
    const initialized = await deps.initialize(intent.clientSecret, id);
    check();
    if (initialized.error) return "failed";
    // Initializing the native sheet may take time. Do not open an expired hold.
    if (!(Date.parse(intent.expiresAt) > deps.now())) return "expired";
    deps.phase("paying");
    const result = await deps.present();
    check();
    if (result.error?.code === "Canceled") return "cancelled";
    if (result.error) return "failed";

    // PaymentSheet success is not reservation confirmation. Only the webhook
    // changes server state. Continue polling past hold expiry for delayed events.
    deps.phase("confirming");
    const polling = new AbortController();
    const abort = () => polling.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, 30000);
    try {
      for (let attempt = 0; attempt < 12; attempt++) {
        check();
        try {
          const current = await deps.read(id, polling.signal);
          check();
          if (current.status === "CONFIRMED") return "confirmed";
          if (
            current.status === "CANCELLED" ||
            current.status === "EXPIRED" ||
            current.status === "COMPLETED"
          )
            return "unavailable";
        } catch {
          check();
          if (polling.signal.aborted) break;
        }
        if (attempt < 11) {
          try {
            await deps.sleep(2000, polling.signal);
          } catch {
            check();
            break;
          }
        }
      }
      return "pending";
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      polling.abort();
    }
  }

  return {
    run(id: string, signal: AbortSignal): Promise<CheckoutResult> {
      if (flight) return flight;
      flight = execute(id, signal).finally(() => {
        flight = null;
      });
      return flight;
    },
  };
}

export function checkoutDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Aborted"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new Error("Aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
