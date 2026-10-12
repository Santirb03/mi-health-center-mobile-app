import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { KeyboardAvoidingView, Platform, Text, View, type TextInputProps } from "react-native";
import { Page, Action, LoadState, styles } from "../../components/booking-ui";
import { AuthInput as FormInput } from "../../components/auth-input";
import { usePatientIdentity } from "../../hooks/use-patient-list";
import { session } from "../../services/api";
import { businessDate } from "../../services/booking";
import { getErrorMessage } from "../../services/errors";
import { createPatient, getPatient, updatePatient, type Patient } from "../../services/patients";
import { formFromPatient, patientErrors, patientPatch, patientPayload, serverFieldErrors, type PatientForm, type PatientErrors } from "../../services/patient-form";

export default function PatientFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const version = usePatientIdentity();
  if (!session.getTokens()) return null;
  return <FormLoader key={`${version}:${id ?? "new"}`} id={typeof id === "string" ? id : undefined} version={version} />;
}
function FormLoader({ id, version }: { id?: string; version: number }) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setLoading(true); setError(null);
    void getPatient(id, controller.signal).then(result => {
      if (!controller.signal.aborted && session.getVersion() === version) setPatient(result);
    }).catch(failure => {
      if (controller.signal.aborted || session.getVersion() !== version) return;
      if (axios.isAxiosError(failure) && failure.response?.status === 404) setMissing(true);
      else setError(getErrorMessage(failure, "No pudimos cargar el paciente. Intenta de nuevo."));
    }).finally(() => {
      if (!controller.signal.aborted && session.getVersion() === version) setLoading(false);
    });
    return () => controller.abort();
  }, [id, version, attempt]);
  if (id && !patient) return <Page>
    <Text style={styles.title}>Editar paciente</Text>
    {missing ? <Text accessibilityRole="alert">Este paciente ya no está disponible.</Text>
      : <LoadState loading={loading} error={error} reload={async () => { setAttempt(value => value + 1); }} />}
    <Action title="Volver a pacientes" variant="secondary" onPress={() => router.replace("/patients")} />
  </Page>;
  return <PatientEditor original={patient} version={version} />;
}
function PatientEditor({ original, version }: { original: Patient | null; version: number }) {
  const [form, setForm] = useState<PatientForm>(() => original ? formFromPatient(original)
    : { firstName: "", lastName: "", phone: "", email: "", dateOfBirth: "" });
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<PatientErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && session.getVersion() === version && !!session.getTokens();
  const errors = { ...(submitted ? patientErrors(form, businessDate()) : {}), ...serverErrors };
  const patch = original ? patientPatch(original, form) : null;
  function change(field: keyof PatientForm, value: string) {
    setForm(previous => ({ ...previous, [field]: value }));
    setServerErrors(previous => {
      const next = { ...previous };
      delete next[field];
      return next;
    });
    setError(null);
  }
  async function save() {
    if (writing.current || !current() || missing) return;
    setSubmitted(true);
    const local = patientErrors(form, businessDate());
    if (Object.keys(local).length || (original && !patch)) return;
    writing.current = true; setBusy(true); setError(null); setServerErrors({});
    try {
      const patient = original ? await updatePatient(original.id, patch!) : await createPatient(patientPayload(form));
      if (current()) router.replace({ pathname: "/patients/[id]", params: { id: patient.id } });
    } catch (failure) {
      if (!current()) return;
      if (axios.isAxiosError(failure) && failure.response?.status === 400) {
        const mapped = serverFieldErrors(failure.response.data?.message);
        setServerErrors(mapped.fields); setError(mapped.general);
      } else if (axios.isAxiosError(failure) && failure.response?.status === 404) {
        setMissing(true); setError("Este paciente ya no está disponible.");
      } else setError(getErrorMessage(failure, "No pudimos guardar el paciente. Intenta de nuevo."));
    } finally {
      writing.current = false;
      if (current()) setBusy(false);
    }
  }
  const fields: { key: keyof PatientForm; label: string; help?: string; keyboard?: TextInputProps["keyboardType"] }[] = [
    { key: "firstName", label: "Nombre" }, { key: "lastName", label: "Apellidos" },
    { key: "phone", label: "Teléfono", help: "10 dígitos; puedes incluir +52", keyboard: "phone-pad" },
    { key: "email", label: "Correo", keyboard: "email-address" },
    { key: "dateOfBirth", label: "Fecha de nacimiento", help: "AAAA-MM-DD", keyboard: "numbers-and-punctuation" },
  ];
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <Page>
      <Text style={styles.title} accessibilityRole="header">{original ? "Editar paciente" : "Nuevo paciente"}</Text>
      {fields.map(field => <View key={field.key} style={{ gap: 6 }}>
        <Text>{field.label}{["firstName", "lastName"].includes(field.key) ? " *" : " (opcional)"}</Text>
        <FormInput accessibilityLabel={field.label} accessibilityHint={field.help} value={form[field.key]}
          onChangeText={value => change(field.key, value)} error={errors[field.key]} editable={!busy && !missing}
          keyboardType={field.keyboard} autoCorrect={false} autoCapitalize={field.key === "firstName" || field.key === "lastName" ? "words" : "none"}
          autoComplete="off" textContentType="none" placeholder={field.key === "dateOfBirth" ? "AAAA-MM-DD" : undefined}
          style={{ borderWidth: 1, borderColor: "#526477", padding: 12, borderRadius: 8, minHeight: 44 }} />
        {field.help && <Text style={styles.muted}>{field.help}</Text>}
      </View>)}
      {error && <Text accessibilityRole="alert">{error}</Text>}
      {original && !patch && <Text accessibilityLiveRegion="polite">Sin cambios</Text>}
      <Action title={busy ? "Guardando..." : "Guardar paciente"} disabled={busy || missing || (!!original && !patch)} onPress={() => void save()} />
      <Action title={original ? "Volver al detalle" : "Volver a pacientes"} variant="secondary" disabled={busy}
        onPress={() => original ? router.replace({ pathname: "/patients/[id]", params: { id: original.id } }) : router.replace("/patients")} />
    </Page>
  </KeyboardAvoidingView>;
}
