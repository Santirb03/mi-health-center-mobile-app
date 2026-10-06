import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router } from "expo-router";
import { Action, LoadState, Page, styles } from "../components/booking-ui";
import { RefundStatus } from "../components/refund-status";
import { PaymentReceiptModal } from "../components/payment-receipt-modal";
import type { PaymentHistoryItem } from "../services/payment-history";
import { usePaymentHistory } from "../hooks/use-payment-history";
import { formatTime, money } from "../services/booking";
import { dayLongLabel, reservationDay } from "../services/calendar";
import { paymentDateLabel, paymentStatusText, reservationNote } from "../services/payment-history";

export default function Payments() {
  const [selected, setSelected] = useState<PaymentHistoryItem | null>(null);
  const { state, reload, more, retry } = usePaymentHistory();
  const initial = state.items.length === 0;
  return (
    <Page>
      <Text accessibilityRole="header" style={styles.title}>Mis pagos</Text>
      <Text style={styles.muted}>
        Montos en pesos mexicanos (MXN). Horarios de Ciudad de México.
      </Text>
      <Action
        title={state.loading && initial ? "Cargando pagos…" : "Actualizar"}
        disabled={state.loading}
        onPress={() => void reload()}
      />
      {state.totals !== null && (
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.subtitle}>Resumen de pagos</Text>
          <Text>Pagado: {money(state.totals.paid)} MXN</Text>
          <Text>Reembolsado: {money(state.totals.refunded)} MXN</Text>
          <Text>Neto: {money(state.totals.net)} MXN</Text>
          <Text style={styles.muted}>
            Reembolsado incluye solo las devoluciones que Stripe ya confirmó como procesadas.
          </Text>
        </View>
      )}
      {initial && <LoadState loading={state.loading} error={state.error} reload={retry} />}
      {initial && !state.loading && !state.error && (
        <Text>Aún no tienes pagos registrados.</Text>
      )}
      {state.items.map((item) => {
        const note = reservationNote(item.reservation.status);
        return (
          <View key={item.id} style={styles.card}>
            <Text accessibilityRole="header" style={styles.subtitle}>{item.reservation.room.name}</Text>
            <Text>{dayLongLabel(reservationDay(item.reservation.startTime))}</Text>
            <Text>{formatTime(item.reservation.startTime)} – {formatTime(item.reservation.endTime)}</Text>
            <Text>{money(item.amount)} MXN</Text>
            <Text>{paymentStatusText(item.status)}</Text>
            <Text>Pago: {paymentDateLabel(item.paidAt)}</Text>
            {note !== null && <Text>{note}</Text>}
            <RefundStatus payment={item} />
            <Action title="Ver reserva" onPress={() => router.push({
              pathname: "/reservations/[id]", params: { id: item.reservationId },
            })} />
            <Action title="Ver comprobante" variant="secondary" onPress={() => setSelected(item)} />
          </View>
        );
      })}
      {!initial && state.loading && (
        <ActivityIndicator accessibilityLabel="Cargando más pagos" accessibilityState={{ busy: true }} />
      )}
      {!initial && state.error && (
        <>
          <Text accessibilityRole="alert">{state.error}</Text>
          <Action title="Reintentar" disabled={state.loading} onPress={() => void retry()} />
        </>
      )}
      {state.nextCursor !== null && !state.error && (
        <Action title={state.loading ? "Cargando…" : "Cargar más"}
          disabled={state.loading} onPress={() => void more()} />
      )}
      {selected && <PaymentReceiptModal key={selected.id} item={selected} onClose={() => setSelected(null)} />}
    </Page>
  );
}
