import type { PropsWithChildren } from "react";

// Stripe's native module is intentionally not imported by the web bundle.
export function PaymentProvider({ children }: PropsWithChildren) {
  return <>{children}</>;
}
