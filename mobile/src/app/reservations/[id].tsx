import { useCallback } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Action, LoadState, Page, styles } from "../../components/booking-ui";
import { useResource } from "../../hooks/use-resource";
import { useNow } from "../../hooks/use-now";
import { getReservation } from "../../services/reservations";
import { ReservationPayment } from "../../components/reservation-payment";
import {
  businessDate,
  formatTime,
  money,
  reservationLabel,
} from "../../services/booking";

export default function ReservationDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const read = useCallback(
    (signal: AbortSignal) => getReservation(id, signal),
    [id],
  );
  const resource = useResource(read);
  const now = useNow();
  const reservation = resource.data;
  const seconds = reservation?.expiresAt
    ? Math.max(0, Math.ceil((Date.parse(reservation.expiresAt) - now) / 1000))
    : 0;
  return (
    <Page>
      <Text style={styles.title}>Tu reserva</Text>
      <LoadState {...resource} />
      {reservation && (
        <View style={styles.card}>
          <Text style={styles.subtitle}>
            {reservation.room?.name || "Consultorio"}
          </Text>
          <Text>
            {businessDate(new Date(reservation.startTime))} ·{" "}
            {formatTime(reservation.startTime)}–
            {formatTime(reservation.endTime)}
          </Text>
          <Text style={styles.muted}>Hora de Ciudad de México</Text>
          <Text style={styles.subtitle}>
            {reservationLabel(reservation, now)}
          </Text>
          <Text>Total: {money(reservation.totalPrice)} MXN</Text>
          {reservation.status === "CONFIRMED" && (
            <Text style={styles.muted}>
              Tu horario está confirmado. No necesitas volver a pagar esta reserva.
            </Text>
          )}
          {(reservation.status === "CANCELLED" || reservation.status === "EXPIRED") && (
            <Text style={styles.muted}>
              Esta reserva ya no está activa. Si realizaste un pago y tienes dudas,
              consulta con administración usando la referencia de abajo.
            </Text>
          )}
          {reservation.status === "PENDING" && (
            <>
              <Text>
                {seconds > 0
                  ? `Retención restante: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
                  : "El tiempo de retención terminó. Actualiza para consultar el estado del servidor."}
              </Text>
              <Text style={styles.muted}>
                El contador es orientativo. Solo el servidor puede confirmar la
                reserva.
              </Text>
            </>
          )}
          <Text selectable style={styles.muted}>
            Referencia: {reservation.id}
          </Text>
        </View>
      )}
      <ReservationPayment key={id} id={id} reservation={reservation} refresh={resource.reload} />
      <Action
        title={resource.loading ? "Consultando estado…" : "Actualizar estado"}
        disabled={resource.loading}
        onPress={() => void resource.reload()}
      />
      <Action
        title="Mis reservas"
        onPress={() => router.replace("/reservations")}
      />
    </Page>
  );
}
