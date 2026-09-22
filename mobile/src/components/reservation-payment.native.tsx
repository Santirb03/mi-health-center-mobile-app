import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import * as Linking from "expo-linking";
import { useStripe } from "@stripe/stripe-react-native";
import { Action, styles } from "./booking-ui";
import type { ReservationPaymentProps } from "./reservation-payment";
import {
  canPay,
  checkoutDelay,
  createCheckout,
  type CheckoutPhase,
  type CheckoutResult,
} from "../services/checkout";
import { getReservation } from "../services/reservations";
import { createPaymentIntent } from "../services/payments";
import { stripeTestConfigured } from "../services/stripe-config";
import { session } from "../services/api";
import { useNow } from "../hooks/use-now";

const messages: Record<CheckoutResult, string> = {
  confirmed: "Reserva confirmada por el servidor.",
  pending:
    "Stripe terminó el pago, pero el servidor aún no confirma la reserva. Actualiza el estado; no vuelvas a pagar.",
  cancelled:
    "Cerraste el formulario de pago. La reserva aún requiere confirmación del servidor.",
  failed:
    "No se pudo completar el pago. Actualiza el estado antes de reintentar; no asumas que hubo un cobro.",
  expired: "La retención venció. Actualiza el estado de la reserva.",
  unavailable:
    "Esta reserva ya no puede confirmarse por este flujo. Revisa su estado; si se cobró, consulta con administración.",
};

export function ReservationPayment({
  id,
  reservation,
  refresh,
}: ReservationPaymentProps) {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const now = useNow();
  const active = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const request = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<CheckoutPhase>("preparing");
  const [message, setMessage] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      return () => {
        active.current = false;
        request.current?.abort();
      };
    }, [id]),
  );

  async function pay() {
    if (
      busyRef.current ||
      awaitingConfirmation ||
      !reservation ||
      !canPay(reservation) ||
      !stripeTestConfigured
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    const controller = new AbortController();
    request.current = controller;
    const version = session.getVersion();
    const current = () =>
      active.current &&
      !controller.signal.aborted &&
      session.getVersion() === version;
    const checkout = createCheckout({
      read: getReservation,
      createIntent: createPaymentIntent,
      initialize: (paymentIntentClientSecret, reservationId) =>
        initPaymentSheet({
          merchantDisplayName: "Mi Health Center",
          paymentIntentClientSecret,
          returnURL: Linking.createURL(`reservations/${reservationId}`),
          allowsDelayedPaymentMethods: false,
          primaryButtonLabel: "Pagar",
        }),
      present: presentPaymentSheet,
      current,
      now: Date.now,
      sleep: checkoutDelay,
      phase: (value) => {
        if (current()) setPhase(value);
      },
    });
    try {
      const result = await checkout.run(id, controller.signal);
      if (current()) {
        setMessage(messages[result]);
        setAwaitingConfirmation(result === "pending" || result === "confirmed");
        await refresh();
      }
    } catch {
      if (current()) {
        setMessage(
          "No pudimos verificar el resultado. Actualiza la reserva antes de reintentar.",
        );
        await refresh();
      }
    } finally {
      busyRef.current = false;
      if (mounted.current && session.getVersion() === version) setBusy(false);
    }
  }

  const pending = reservation?.status === "PENDING";
  const payable = !!reservation && canPay(reservation, now);
  // Keep checkout state mounted while refreshing, but hide obsolete messages
  // once the server has returned a final reservation status.
  if (!busy && reservation && !pending) return null;
  if (!busy && !message && !pending) return null;

  return (
    <View style={styles.card}>
      {message && <Text accessibilityRole="alert">{message}</Text>}
      {(busy || awaitingConfirmation || (pending && payable)) && (
        <>
          <Text style={styles.muted}>
            Modo de prueba · utiliza únicamente tarjetas de prueba de Stripe.
          </Text>
          {!stripeTestConfigured && (
            <Text style={styles.muted}>
              El pago de prueba todavía no está disponible. Falta configurar el servicio de pagos.
            </Text>
          )}
          <Action
            title={
              busy
                ? {
                    preparing: "Preparando pago…",
                    paying: "Pago en curso…",
                    confirming: "Esperando confirmación…",
                  }[phase]
                : awaitingConfirmation
                  ? "Pago enviado · actualiza el estado"
                  : "Pagar reserva"
            }
            disabled={!stripeTestConfigured || busy || awaitingConfirmation || !payable}
            onPress={() => void pay()}
          />
        </>
      )}
      {pending && !payable && !busy && !awaitingConfirmation && (
        <Text style={styles.muted}>
          El plazo para pagar terminó. Actualiza el estado antes de intentar otra reserva.
          Si ya pagaste, consulta con administración antes de volver a pagar.
        </Text>
      )}
    </View>
  );
}
