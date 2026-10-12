import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Alert, Text, View } from "react-native";
import { Page, Action, LoadState, styles } from "../../components/booking-ui";
import { usePatientIdentity } from "../../hooks/use-patient-list";
import { useResource } from "../../hooks/use-resource";
import { useNow } from "../../hooks/use-now";
import { session } from "../../services/api";
import { businessDate, formatTime } from "../../services/booking";
import { getErrorMessage } from "../../services/errors";
import { getAppointment, cancelAppointment, completeAppointment } from "../../services/appointments";
import { appointmentActions, appointmentFailure, appointmentLabels, cancelMessage, roomDescription, roomWarning } from "../../services/appointment-schedule";

export default function AppointmentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const version = usePatientIdentity();
  if (!session.getTokens()) return null;
  return <Detail key={`${version}:${id}`} id={typeof id === "string" ? id : ""} version={version} />;
}
function Detail({ id, version }: { id: string; version: number }) {
  const [missing, setMissing] = useState(!id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const writing = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && session.getVersion() === version && !!session.getTokens();
  const read = useCallback(async (signal: AbortSignal) => {
    if (!id || session.getVersion() !== version || !session.getTokens()) throw new Error("Unavailable");
    try {
      const result = await getAppointment(id, signal);
      if (session.getVersion() !== version || !session.getTokens()) throw new Error("Session changed");
      return result;
    } catch (failure) {
      if (!signal.aborted && session.getVersion() === version && axios.isAxiosError(failure) && failure.response?.status === 404) setMissing(true);
      throw failure;
    }
  }, [id, version]);
  const resource = useResource(read), now = useNow();
  const item = resource.data;
  async function transition(target: "cancel" | "complete") {
    if (writing.current || !current() || !item || missing || !appointmentActions(item, Date.now())[target]) return;
    writing.current = true; setBusy(true); setError(null);
    try {
      await (target === "cancel" ? cancelAppointment(id) : completeAppointment(id));
      if (current()) await resource.reload();
    } catch (failure) {
      if (!current()) return;
      const status = axios.isAxiosError(failure) ? failure.response?.status : undefined;
      if (status === 404) setMissing(true);
      setError(appointmentFailure(status, axios.isAxiosError(failure) ? failure.response?.data?.message : null)
        ?? getErrorMessage(failure, "No pudimos actualizar la cita. Intenta de nuevo."));
    } finally { writing.current = false; if (current()) setBusy(false); }
  }
  const actions = item ? appointmentActions(item, now) : null;
  return <Page>
    <Text style={styles.title} accessibilityRole="header">Cita</Text>
    {missing ? <Text accessibilityRole="alert">Esta cita ya no está disponible.</Text> : <>
      <LoadState {...resource} />
      {item && <View style={styles.card} accessibilityState={{ busy }}>
        <Text style={styles.subtitle}>{item.patient.firstName} {item.patient.lastName}</Text>
        <Text>{businessDate(new Date(item.startTime))} · {formatTime(item.startTime)}–{formatTime(item.endTime)}</Text>
        <Text>{appointmentLabels[item.status]}</Text>
        <Text>{roomDescription(item)}</Text>
        {item.reservation && <Text>Reserva: {({ CONFIRMED: "Confirmada", CANCELLED: "Cancelada", COMPLETED: "Completada", PENDING: "Pendiente", EXPIRED: "Vencida" } as Record<string, string>)[item.reservation.status] ?? "Revisar estado"}</Text>}
        {roomWarning(item) && <Text accessibilityRole="alert">{roomWarning(item)}</Text>}
        {actions?.reschedule && <Action title="Reprogramar" disabled={busy} onPress={() => router.push({ pathname: "/appointments/form", params: { id } })} />}
        {actions?.cancel && <Action title="Cancelar cita" variant="danger" disabled={busy} onPress={() => {
          if (!current()) return;
          Alert.alert("Cancelar cita", cancelMessage, [{ text: "Conservar cita", style: "cancel" },
            { text: "Cancelar cita", style: "destructive", onPress: () => void transition("cancel") }]);
        }} />}
        {actions?.complete && <Action title="Marcar como completada" disabled={busy} onPress={() => void transition("complete")} />}
      </View>}
      {error && <Text accessibilityRole="alert">{error}</Text>}
      <Action title="Actualizar detalle" variant="quiet" disabled={busy || resource.loading} onPress={() => { setError(null); void resource.reload(); }} />
    </>}
    <Action title="Volver a citas" variant="secondary" disabled={busy} onPress={() => router.replace("/appointments")} />
  </Page>;
}
