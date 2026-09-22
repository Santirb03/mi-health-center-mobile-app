import { ActivityIndicator, Text, View } from "react-native";
import { router } from "expo-router";
import { Action, Page, styles } from "../../components/booking-ui";
import { useReservationPages } from "../../hooks/use-reservation-pages";
import { useNow } from "../../hooks/use-now";
import { reservationSections } from "../../services/reservation-pager";
import { canPay } from "../../services/checkout";
import {
  businessDate,
  formatTime,
  money,
  reservationLabel,
  reservationGroups,
} from "../../services/booking";

export default function Reservations() {
  const resource = useReservationPages();
  const now = useNow();
  const pages = reservationSections.map((key) => resource.pages[key]);
  const loading = pages.some((page) => page.loading);
  const items = [...new Map(pages.flatMap((page) => page.items).map((item) => [item.id, item])).values()];
  return (
    <Page>
      <Text style={styles.title}>Mis reservas</Text>
      <Text style={styles.muted}>
        Horarios de Ciudad de México. Una reserva pendiente todavía no está
        confirmada.
      </Text>
      <Action
        title={loading ? "Cargando reservas…" : "Actualizar"}
        disabled={loading}
        onPress={() => void resource.reload()}
      />
      {!loading && pages.every((page) => !page.error) && items.length === 0 && (
        <View style={styles.card}>
          <Text style={styles.subtitle}>Aún no tienes reservas</Text>
          <Text style={styles.muted}>
            En Ver consultorios puedes elegir un consultorio y consultar sus horarios disponibles.
          </Text>
        </View>
      )}
      {reservationGroups(items, now)
        .map((group, index) => ({ ...group, key: reservationSections[index], page: pages[index] }))
        .filter((group) => group.items.length > 0 || group.page.loading || group.page.error || group.page.nextCursor)
        .map((group) => (
          <View key={group.title} style={{ gap: 12 }}>
            <Text accessibilityRole="header" style={styles.subtitle}>
              {group.title} ({group.items.length} cargadas)
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
            {group.page.loading && <ActivityIndicator accessibilityLabel="Cargando reservas" />}
            {group.page.error && <Text accessibilityRole="alert">{group.page.error}</Text>}
            {(group.page.nextCursor || group.page.error) && (
              <Action
                title={group.page.loading ? "Cargando…" : group.page.error ? "Reintentar" : "Cargar más"}
                disabled={group.page.loading}
                onPress={() => void resource.more(group.key)}
              />
            )}
          </View>
        ))}
      <Action
        title="Ver consultorios"
        onPress={() => router.replace("/home")}
      />
    </Page>
  );
}
