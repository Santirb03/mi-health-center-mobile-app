import { api } from "./api";
import type { PaymentIntentResponse } from "./checkout";

export async function createPaymentIntent(id: string, signal: AbortSignal) {
  return (
    await api.post<PaymentIntentResponse>(
      `/payments/reservations/${encodeURIComponent(id)}`,
      undefined,
      { signal },
    )
  ).data;
}
