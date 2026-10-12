import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { Page, Action, LoadState, styles } from "../../components/booking-ui";
import { Choice } from "../../components/admin-ui";
import { AuthInput as FormInput } from "../../components/auth-input";
import { usePatientIdentity } from "../../hooks/use-patient-list";
import { useResource } from "../../hooks/use-resource";
import { session } from "../../services/api";
import { businessDate, formatTime } from "../../services/booking";
import { getErrorMessage } from "../../services/errors";
import { getCalendar, getReservationPage, type Reservation } from "../../services/reservations";
import { createAppointment, getAppointment, updateAppointment, type Appointment } from "../../services/appointments";
import { appointmentErrors, appointmentInstant, appointmentPatch, appointmentPayload, appointmentServerErrors,
  containsAppointment, formFromAppointment, type AppointmentForm, type AppointmentErrors } from "../../services/appointment-form";
import { appointmentActions, appointmentFailure, confirmedReservationsForDay } from "../../services/appointment-schedule";
import { PatientPicker } from "./index";

export default function AppointmentFormScreen() {
  const { id, patientId } = useLocalSearchParams<{ id?: string; patientId?: string }>();
  const version = usePatientIdentity();
  if (!session.getTokens()) return null;
  return <FormLoader key={`${version}:${id ?? "new"}:${patientId ?? ""}`} version={version}
    id={typeof id === "string" ? id : undefined} patientId={typeof patientId === "string" ? patientId : ""} />;
}
function FormLoader({ id, patientId, version }: { id?: string; patientId: string; version: number }) {
  const [original, setOriginal] = useState<Appointment | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setLoading(true); setError(null);
    void getAppointment(id, controller.signal).then(result => {
      if (!controller.signal.aborted && session.getVersion() === version && session.getTokens()) setOriginal(result);
    }).catch(failure => {
      if (controller.signal.aborted || session.getVersion() !== version || !session.getTokens()) return;
      const status = axios.isAxiosError(failure) ? failure.response?.status : undefined;
      setError(appointmentFailure(status, null) ?? getErrorMessage(failure, "No pudimos cargar la cita. Intenta de nuevo."));
    }).finally(() => {
      if (!controller.signal.aborted && session.getVersion() === version) setLoading(false);
    });
    return () => controller.abort();
  }, [id, version, attempt]);
  if (id && !original) return <Page>
    <Text style={styles.title} accessibilityRole="header">Reprogramar cita</Text>
    <LoadState loading={loading} error={error} reload={async () => { setAttempt(value => value + 1); }} />
    <Action title="Volver a citas" onPress={() => router.replace("/appointments")} />
  </Page>;
  return <AppointmentEditor original={original} patientId={patientId} version={version} />;
}
function AppointmentEditor({ original, patientId, version }: { original: Appointment | null; patientId: string; version: number }) {
  const [form, setForm] = useState<AppointmentForm>(() => original ? formFromAppointment(original)
    : { patientId, reservationId: "", date: businessDate(), start: "", end: "" });
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<AppointmentErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const writing = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && session.getVersion() === version && !!session.getTokens();
  const reservation = reservations.find(item => item.id === form.reservationId);
  const errors = { ...(submitted ? appointmentErrors(form, reservation) : {}), ...serverErrors };
  const unavailable = !!original && !appointmentActions(original, Date.now()).reschedule;
  function change(field: keyof AppointmentForm, value: string) {
    setForm(previous => ({ ...previous, [field]: value,
      ...(field === "date" || field === "start" || field === "end" ? { reservationId: "" } : {}) }));
    if (field === "date") setReservations([]);
    setServerErrors(previous => { const next = { ...previous }; delete next[field]; return next; });
    setError(null);
  }
  async function save() {
    if (writing.current || !current() || missing || unavailable) return;
    setSubmitted(true);
    if (Object.keys(appointmentErrors(form, reservation)).length) return;
    writing.current = true; setBusy(true); setError(null); setServerErrors({});
    try {
      const result = original ? await updateAppointment(original.id, appointmentPatch(form)) : await createAppointment(appointmentPayload(form));
      if (current()) router.replace({ pathname: "/appointments/[id]", params: { id: result.id } });
    } catch (failure) {
      if (!current()) return;
      const status = axios.isAxiosError(failure) ? failure.response?.status : undefined;
      if (status === 400 && axios.isAxiosError(failure)) {
        const mapped = appointmentServerErrors(failure.response?.data?.message);
        setServerErrors(mapped.fields); setError(mapped.general);
      } else {
        if (status === 404) setMissing(true);
        setError(appointmentFailure(status, axios.isAxiosError(failure) ? failure.response?.data?.message : undefined)
          ?? getErrorMessage(failure, "No pudimos guardar la cita. Intenta de nuevo. Antes de repetir, revisa tu agenda para comprobar si se guardó."));
      }
    } finally { writing.current = false; if (current()) setBusy(false); }
  }
  const disabled = busy || missing || unavailable;
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <Page>
      <Text style={styles.title} accessibilityRole="header">{original ? "Reprogramar cita" : "Nueva cita"}</Text>
      <Text style={styles.muted}>Horarios de Ciudad de México · AAAA-MM-DD y HH:mm.</Text>
      {original ? <Text>Paciente: {original.patient.firstName} {original.patient.lastName}</Text>
        : <PatientPicker patientId={form.patientId} onSelect={value => change("patientId", value)} version={version} disabled={disabled} />}
      {errors.patientId && <Text accessibilityRole="alert">{errors.patientId}</Text>}
      {([{ key: "date", label: "Fecha", placeholder: "AAAA-MM-DD" }, { key: "start", label: "Hora de inicio", placeholder: "HH:mm" },
        { key: "end", label: "Hora de fin", placeholder: "HH:mm" }] as const).map(field => <View key={field.key} style={{ gap: 6 }}>
        <Text>{field.label} *</Text>
        <FormInput accessibilityLabel={field.label} value={form[field.key]} onChangeText={value => change(field.key, value)}
          error={errors[field.key]} editable={!disabled} placeholder={field.placeholder} keyboardType="numbers-and-punctuation"
          autoCorrect={false} autoCapitalize="none" autoComplete="off" textContentType="none"
          style={{ borderWidth: 1, padding: 12, borderRadius: 8, minHeight: 44 }} />
      </View>)}
      <ReservationPicker key={`${version}:${form.date}`} form={form} version={version} disabled={disabled}
        onSelect={value => change("reservationId", value)} onLoaded={setReservations} />
      {errors.reservationId && <Text accessibilityRole="alert">{errors.reservationId}</Text>}
      {unavailable && <Text accessibilityRole="alert">Esta cita ya no se puede reprogramar. Revisa su detalle.</Text>}
      {error && <Text accessibilityRole="alert">{error}</Text>}
      <View accessibilityState={{ busy }}><Action title={busy ? "Guardando..." : "Guardar cita"} disabled={disabled} onPress={() => void save()} /></View>
      <Action title="Volver a citas" variant="secondary" disabled={busy} onPress={() => router.replace("/appointments")} />
    </Page>
  </KeyboardAvoidingView>;
}
function ReservationPicker({ form, version, disabled, onSelect, onLoaded }: {
  form: AppointmentForm; version: number; disabled: boolean; onSelect(id: string): void; onLoaded(items: Reservation[]): void;
}) {
  const read = useCallback(async (signal: AbortSignal) => {
    const check = () => { if (signal.aborted || session.getVersion() !== version || !session.getTokens()) throw new Error("Session changed"); };
    check();
    const result = await confirmedReservationsForDay(form.date, signal,
      async (from, to, abort) => { check(); const result = await getCalendar(from, to, abort); check(); return result; },
      async (cursor, abort) => { check(); const result = await getReservationPage("confirmed", cursor, abort); check(); return result; });
    check(); return result;
  }, [form.date, version]);
  const resource = useResource(read);
  useEffect(() => { onLoaded(resource.data ?? []); }, [resource.data, onLoaded]);
  const start = appointmentInstant(form.date, form.start), end = appointmentInstant(form.date, form.end);
  const options = resource.data?.filter(item => start && end && containsAppointment(item, start, end)) ?? [];
  return <View style={{ gap: 8 }}>
    <Text accessibilityRole="header" style={styles.subtitle}>Reserva confirmada</Text>
    <LoadState {...resource} />
    {!start || !end ? <Text>Completa fecha y horario para ver las reservas que pueden contener la cita.</Text>
      : resource.data && !options.length && <Text>No hay reservas confirmadas que contengan este horario. Reserva un consultorio desde Inicio.</Text>}
    {options.map(item => <Choice key={item.id} title={`${item.room?.name ?? "Consultorio"} · ${formatTime(item.startTime)}–${formatTime(item.endTime)}`}
      selected={form.reservationId === item.id} disabled={disabled} onPress={() => onSelect(item.id)} />)}
    <Action title="Actualizar reservas" variant="quiet" disabled={disabled || resource.loading} onPress={() => void resource.reload()} />
  </View>;
}
