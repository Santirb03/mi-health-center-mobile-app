import { useEffect, type PropsWithChildren } from "react";
import { StripeProvider, useStripe } from "@stripe/stripe-react-native";
import * as Linking from "expo-linking";
import {
  stripePublishableKey,
  stripeTestConfigured,
} from "../services/stripe-config";

function PaymentLinks({ children }: PropsWithChildren) {
  const { handleURLCallback } = useStripe();
  useEffect(() => {
    const handle = (url: string) => {
      void handleURLCallback(url).catch(() => {});
    };
    void Linking.getInitialURL()
      .then((url) => {
        if (url) handle(url);
      })
      .catch(() => {});
    const subscription = Linking.addEventListener("url", ({ url }) =>
      handle(url),
    );
    return () => subscription.remove();
  }, [handleURLCallback]);
  return <>{children}</>;
}

export function PaymentProvider({ children }: PropsWithChildren) {
  if (!stripeTestConfigured) return <>{children}</>;
  return (
    <StripeProvider
      publishableKey={stripePublishableKey}
      urlScheme={Linking.createURL("").split(":")[0]}
    >
      <PaymentLinks>{children}</PaymentLinks>
    </StripeProvider>
  );
}
