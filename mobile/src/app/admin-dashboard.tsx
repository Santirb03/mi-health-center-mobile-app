import { useCallback, useState } from "react";
import { router } from "expo-router";
import { Text, View } from "react-native";
import { Action, LoadState, Page, styles } from "../components/booking-ui";
import { AdminNav, Choice, DateNavigator } from "../components/admin-ui";
import { useResource } from "../hooks/use-resource";
import { getCurrentUser, getDashboard } from "../services/admin-agenda";
import { businessDate, formatTime, money, shiftDate } from "../services/booking";
import {
  cancellationRateBp, formatBp, formatMinutes, overallUtilization, periodLabel,
  periodRange, rankRooms, shiftAnchor, validateCustomRange,
  type PeriodKind,
} from "../services/dashboard";

export default function AdminDashboard() {
  const user = useResource(getCurrentUser);
  if (user.data?.role === "ADMIN") return <Dashboard />;
  return (
    <Page>
      <LoadState {...user} />
      {user.data && <Text>Este resumen está disponible únicamente para administradores.</Text>}
      <Action title="Volver al inicio" onPress={() => router.replace("/home")} />
    </Page>
  );
}

function Dashboard() {
  const [kind, setKind] = useState<PeriodKind>("week");
  const [anchor, setAnchor] = useState(businessDate);
  const [fromCustom, setFromCustom] = useState(() => shiftDate(businessDate(), -29));
  const [toCustom, setToCustom] = useState(businessDate);
  const [order, setOrder] = useState<"utilization" | "net">("utilization");
  const { from, to } = kind === "custom" ? { from: fromCustom, to: toCustom } : periodRange(kind, anchor);
  const rangeError = kind === "custom" ? validateCustomRange(from, to) : null;
  const rangeKey = `${from}|${to}`;
  const read = useCallback(async (signal: AbortSignal) => ({
    dashboard: rangeError ? null : await getDashboard(from, to, signal), rangeKey,
  }), [from, to, rangeKey, rangeError]);
  const resource = useResource(read);
  const data = !rangeError && resource.data?.rangeKey === rangeKey ? resource.data.dashboard : null;
  const overall = data ? overallUtilization(data.rooms) : null;
  return (
    <Page>
      <AdminNav current="/admin-dashboard" />
      <Text accessibilityRole="header" style={styles.title}>Resumen</Text>
      <Text style={styles.muted}>Horarios de Ciudad de México.</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          {([['day', 'Día'], ['week', 'Semana'], ['month', 'Mes'], ['custom', 'Personalizado']] as const).map(([value, title]) => (
            <Choice key={value} title={title} selected={kind === value} onPress={() => setKind(value)} />
          ))}
        </View>
        {kind === "custom" ? (
          <>
            <Text style={styles.subtitle}>Desde</Text>
            <DateNavigator date={fromCustom} onChange={setFromCustom} />
            <Text style={styles.subtitle}>Hasta</Text>
            <DateNavigator date={toCustom} onChange={setToCustom} />
          </>
        ) : (
          <>
            <View style={[styles.row, { flexWrap: "nowrap" }]}>
              <View style={{ flex: 1 }}><Action title="‹ Periodo anterior" variant="quiet" onPress={() => setAnchor(value => shiftAnchor(kind, value, -1))} /></View>
              <Text style={[styles.subtitle, { flex: 1, textAlign: "center" }]}>{periodLabel(kind, anchor)}</Text>
              <View style={{ flex: 1 }}><Action title="Periodo siguiente ›" variant="quiet" onPress={() => setAnchor(value => shiftAnchor(kind, value, 1))} /></View>
            </View>
          </>
        )}
        {rangeError && <Text accessibilityRole="alert">{rangeError}</Text>}
        <Action title="Actualizar" variant="quiet" disabled={resource.loading || !!rangeError} onPress={() => void resource.reload()} />
      </View>
      {!rangeError && <View accessibilityState={{ busy: resource.loading }}><LoadState {...resource} /></View>}
      {data && overall && (
        <>
          <View style={styles.card}>
            <Text accessibilityRole="header" style={styles.subtitle}>Reservas</Text>
            <Text>Confirmadas: {data.reservations.confirmed + data.reservations.completed}</Text>
            <Text>Pendientes de pago: {data.reservations.pendingActive}</Text>
            <Text>Canceladas: {data.reservations.cancelled}</Text>
            <Text>Vencidas: {data.reservations.expired}</Text>
            <Text>Tasa de cancelación: {formatBp(cancellationRateBp(data.reservations))}</Text>
            <Text>{data.cancellations.cancelledWithPayment} canceladas con pago registrado</Text>
          </View>
          <View style={styles.card}>
            <Text accessibilityRole="header" style={styles.subtitle}>Ingresos</Text>
            <Text>Cobrado: {money(data.revenue.paid)} MXN</Text>
            <Text>Reembolsado: {money(data.revenue.refunded)} MXN</Text>
            <Text>Neto: {money(data.revenue.net)} MXN</Text>
            <Text style={styles.muted}>Cobros por fecha de pago. Los reembolsos se restan del periodo en que se cobró el pago.</Text>
          </View>
          <View style={styles.card}>
            <Text accessibilityRole="header" style={styles.subtitle}>Ocupación general</Text>
            <Text>{formatBp(overall.bp)}</Text>
            <Text>{formatMinutes(overall.bookedMinutes)} de {formatMinutes(overall.availableMinutes)} disponibles</Text>
            <Text style={styles.muted}>Horas reservadas ÷ horas disponibles (08:00–21:00, todos los días, descontando bloqueos). Incluye reservas confirmadas próximas.</Text>
            <Text style={styles.muted}>Los consultorios inactivos no se incluyen en la ocupación general. Su capacidad histórica no está disponible.</Text>
          </View>
          <View style={styles.card}>
            <Text accessibilityRole="header" style={styles.subtitle}>Consultorios</Text>
            <View style={styles.row}>
              <Choice title="Por ocupación" selected={order === "utilization"} onPress={() => setOrder("utilization")} />
              <Choice title="Por ingreso neto" selected={order === "net"} onPress={() => setOrder("net")} />
            </View>
            {data.rooms.length === 0 && <Text>No hay consultorios para mostrar.</Text>}
            {rankRooms(data.rooms, order).map(room => (
              <View key={room.roomId} style={{ gap: 6 }}>
                <Text accessibilityRole="header" style={styles.subtitle}>{room.name}</Text>
                {!room.active && <Text>Inactivo</Text>}
                <Text>Ocupación: {formatBp(room.utilizationBp)}</Text>
                <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
                  style={{ height: 8, borderRadius: 4, backgroundColor: "#e9eef4", overflow: "hidden" }}>
                  <View style={{ height: 8, backgroundColor: "#1765ae", width: `${Math.max(0, Math.min(100, (room.utilizationBp ?? 0) / 100))}%` }} />
                </View>
                <Text>Reservado: {formatMinutes(room.bookedMinutes)} de {formatMinutes(room.availableMinutes)}</Text>
                <Text>Cobrado: {money(room.paid)} MXN · Neto: {money(room.net)} MXN</Text>
              </View>
            ))}
          </View>
          <Text style={styles.muted}>Actualizado a las {formatTime(data.generatedAt)}</Text>
        </>
      )}
    </Page>
  );
}
