import { api } from "./api";
import type { PaymentIntentResponse } from "./checkout";
import type { PaymentHistoryPage } from "./payment-history";

export async function createPaymentIntent(id: string, signal: AbortSignal) {
  return (
    await api.post<PaymentIntentResponse>(
      `/payments/reservations/${encodeURIComponent(id)}`,
      undefined,
      { signal },
    )
  ).data;
}

export async function getPaymentHistory(cursor: string | null, signal: AbortSignal) {
  return (await api.get<PaymentHistoryPage>("/payments/history", {
    params: cursor ? { cursor } : {}, signal,
  })).data;
}
