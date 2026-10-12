import { useCallback, useState } from "react";
import { router } from "expo-router";
import { Text, View } from "react-native";
import { Page, Action, LoadState, styles } from "../../components/booking-ui";
import { Choice, DateNavigator } from "../../components/admin-ui";
import { AuthInput as FormInput } from "../../components/auth-input";
import { usePatientIdentity, usePatientList } from "../../hooks/use-patient-list";
import { useAppointmentHistory } from "../../hooks/use-appointment-history";
import { useResource } from "../../hooks/use-resource";
import { session } from "../../services/api";
import { businessDate, formatTime } from "../../services/booking";
import { dayLongLabel } from "../../services/calendar";
import { getAppointmentCalendar, type Appointment } from "../../services/appointments";
import { getPatient } from "../../services/patients";
import { queryMessage } from "../../services/patient-pager";
import { appointmentLabels, calendarMessage, roomDescription, roomWarning } from "../../services/appointment-schedule";

export default function Appointments() {
  const version = usePatientIdentity();
  if (!session.getTokens()) return null;
  return <Agenda key={version} version={version} />;
}
function Agenda({ version }: { version: number }) {
  const [day, setDay] = useState(businessDate);
  const [patientId, setPatientId] = useState<string | null>(null);
  return <Page>
    <Text style={styles.title} accessibilityRole="header">Citas</Text>
    <Text style={styles.muted}>Agenda de pacientes · Horarios de Ciudad de México.</Text>
    <Action title="Nueva cita" onPress={() => router.push("/appointments/form")} />
    <DateNavigator date={day} onChange={setDay} />
    <Action title="Hoy" variant="secondary" onPress={() => setDay(businessDate())} />
    <Daily key={`${version}:${day}`} day={day} version={version} />
    <Text style={styles.subtitle} accessibilityRole="header">Historial de citas</Text>
    <Text style={styles.muted}>Incluye programadas, completadas y canceladas.</Text>
    <PatientPicker patientId={patientId ?? ""} onSelect={setPatientId} version={version} />
    {patientId && <Action title="Todos los pacientes" variant="quiet" onPress={() => setPatientId(null)} />}
    <History patientId={patientId} version={version} />
  </Page>;
}
function Daily({ day, version }: { day: string; version: number }) {
  const read = useCallback(async (signal: AbortSignal) => {
    if (session.getVersion() !== version || !session.getTokens()) throw new Error("Session changed");
    const result = await getAppointmentCalendar(day, day, signal);
    if (session.getVersion() !== version || !session.getTokens()) throw new Error("Session changed");
    return result;
  }, [day, version]);
  const resource = useResource(read);
  const message = calendarMessage(resource.data, resource.loading, resource.error);
  return <View style={{ gap: 12 }}>
    <Text style={styles.subtitle} accessibilityRole="header">{dayLongLabel(day)}</Text>
    <LoadState {...resource} />
    {message && <Text accessibilityRole={resource.data?.truncated ? "alert" : undefined}>{message}</Text>}
    {resource.data?.items.map(item => <AppointmentCard key={item.id} item={item} />)}
    <Action title="Actualizar agenda" variant="quiet" disabled={resource.loading} onPress={() => void resource.reload()} />
  </View>;
}
function History({ patientId, version }: { patientId: string | null; version: number }) {
  const { state, reload, more, retry } = useAppointmentHistory(patientId, version);
  return <View style={{ gap: 12 }}>
    <LoadState loading={state.loading} error={state.error} reload={retry} />
    {!state.loading && !state.error && !state.items.length && <Text>No hay citas en este historial.</Text>}
    {state.items.map(item => <AppointmentCard key={item.id} item={item} />)}
    {state.nextCursor && <Action title="Cargar más citas" disabled={state.loading || !!state.error} onPress={() => void more()} />}
    <Action title="Actualizar historial" variant="quiet" disabled={state.loading} onPress={() => void reload()} />
  </View>;
}
function AppointmentCard({ item }: { item: Appointment }) {
  return <View style={styles.card}>
    <Text style={styles.subtitle}>{item.patient.firstName} {item.patient.lastName}</Text>
    <Text>{businessDate(new Date(item.startTime))} · {formatTime(item.startTime)}–{formatTime(item.endTime)}</Text>
    <Text>{appointmentLabels[item.status]}</Text>
    <Text>{roomDescription(item)}</Text>
    {roomWarning(item) && <Text accessibilityRole="alert">{roomWarning(item)}</Text>}
    <Action title="Ver cita" variant="secondary" onPress={() => router.push({ pathname: "/appointments/[id]", params: { id: item.id } })} />
  </View>;
}
// Shared by these two appointment routes; all patient data remains local to the mounted picker.
export function PatientPicker({ patientId, onSelect, version, disabled = false }: {
  patientId: string; onSelect(id: string): void; version: number; disabled?: boolean;
}) {
  const { state, text, setText, more, retry } = usePatientList();
  const hint = queryMessage(state.kind);
  return <View style={{ gap: 8 }}>
    <Text accessibilityRole="header" style={styles.subtitle}>Seleccionar paciente</Text>
    {patientId && <PatientName key={`${version}:${patientId}`} patientId={patientId} version={version} />}
    <FormInput accessibilityLabel="Buscar paciente" value={text} onChangeText={setText} editable={!disabled}
      placeholder="Buscar pacientes" autoCorrect={false} autoCapitalize="none" autoComplete="off" textContentType="none"
      style={{ borderWidth: 1, padding: 12, borderRadius: 8 }} />
    {hint ? <Text accessibilityLiveRegion="polite">{hint}</Text> : <>
      <LoadState loading={state.loading} error={state.error} reload={retry} />
      {!state.loading && !state.error && !state.items.length && <Text>No encontramos pacientes.</Text>}
      {state.items.map(patient => <Choice key={patient.id} title={`${patient.firstName} ${patient.lastName}`}
        selected={patientId === patient.id} disabled={disabled} onPress={() => onSelect(patient.id)} />)}
      {state.nextCursor && <Action title="Más pacientes" disabled={disabled || state.loading || !!state.error} onPress={() => void more()} />}
    </>}
  </View>;
}
function PatientName({ patientId, version }: { patientId: string; version: number }) {
  const read = useCallback(async (signal: AbortSignal) => {
    if (session.getVersion() !== version || !session.getTokens()) throw new Error("Session changed");
    const result = await getPatient(patientId, signal);
    if (session.getVersion() !== version || !session.getTokens()) throw new Error("Session changed");
    return result;
  }, [patientId, version]);
  const resource = useResource(read);
  return <View><LoadState {...resource} />{resource.data && <Text accessibilityLiveRegion="polite">
    Paciente seleccionado: {resource.data.firstName} {resource.data.lastName}
  </Text>}</View>;
}
