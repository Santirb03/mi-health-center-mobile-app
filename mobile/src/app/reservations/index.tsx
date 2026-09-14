import { useCallback } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { Action, LoadState, Page, styles } from "../../components/booking-ui";
import { useResource } from "../../hooks/use-resource";
import { useNow } from "../../hooks/use-now";
import { getReservations } from "../../services/reservations";
import {
  businessDate,
  formatTime,
  money,
  reservationLabel,
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
        title="Actualizar"
        disabled={resource.loading}
        onPress={() => void resource.reload()}
      />
      <LoadState {...resource} />
      {resource.data?.length === 0 && <Text>Aún no tienes reservas.</Text>}
      {resource.data
        ?.slice()
        .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))
        .map((item) => (
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
              title="Ver reserva"
              onPress={() =>
                router.push({
                  pathname: "/reservations/[id]",
                  params: { id: item.id },
                })
              }
            />
          </View>
        ))}
      <Action
        title="Ver consultorios"
        onPress={() => router.replace("/home")}
      />
    </Page>
  );
}
