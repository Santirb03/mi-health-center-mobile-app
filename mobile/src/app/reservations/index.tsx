import { useCallback } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { Action, LoadState, Page, styles } from "../../components/booking-ui";
import { useResource } from "../../hooks/use-resource";
import { useNow } from "../../hooks/use-now";
import { getReservations } from "../../services/reservations";
import { canPay } from "../../services/checkout";
import {
  businessDate,
  formatTime,
  money,
  reservationLabel,
  reservationGroups,
} from "../../services/booking";

export default function Reservations() {
  const read = useCallback(
    (signal: AbortSignal) => getReservations(signal),
    [],
  );
  const resource = useResource(read);
  const now = useNow();
  return (
    <Page>
      <Text style={styles.title}>Mis reservas</Text>
      <Text style={styles.muted}>
        Horarios de Ciudad de México. Una reserva pendiente todavía no está
        confirmada.
      </Text>
      <Action
        title={resource.loading ? "Actualizando reservas…" : "Actualizar"}
        disabled={resource.loading}
        onPress={() => void resource.reload()}
      />
      <LoadState {...resource} />
      {resource.data?.length === 0 && (
        <View style={styles.card}>
          <Text style={styles.subtitle}>Aún no tienes reservas</Text>
          <Text style={styles.muted}>
            En Ver consultorios puedes elegir un consultorio y consultar sus horarios disponibles.
          </Text>
        </View>
      )}
      {reservationGroups(resource.data ?? [], now)
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <View key={group.title} style={{ gap: 12 }}>
            <Text accessibilityRole="header" style={styles.subtitle}>
              {group.title} ({group.items.length})
            </Text>
            {group.title === "Historial" && (
              <Text style={styles.muted}>
                Reservas pasadas, canceladas o con retención vencida.
              </Text>
            )}
            {group.items.map((item) => (
              <View key={item.id} style={styles.card}>
                <Text style={styles.subtitle}>
                  {item.room?.name || "Consultorio"}
                </Text>
                <Text>
                  {businessDate(new Date(item.startTime))} ·{" "}
                  {formatTime(item.startTime)}–{formatTime(item.endTime)}
                </Text>
                <Text>{reservationLabel(item, now)}</Text>
                <Text>{money(item.totalPrice)} MXN</Text>
                <Action
                  title={canPay(item, now) ? "Ver reserva y pagar" : "Ver reserva"}
                  onPress={() =>
                    router.push({
                      pathname: "/reservations/[id]",
                      params: { id: item.id },
                    })
                  }
                />
              </View>
            ))}
          </View>
        ))}
      <Action
        title="Ver consultorios"
        onPress={() => router.replace("/home")}
      />
    </Page>
  );
}
