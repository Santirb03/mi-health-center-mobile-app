import { router } from "expo-router";
import { Pressable, Text } from "react-native";
import { Page, Action, LoadState, styles } from "../../components/booking-ui";
import { AuthInput as FormInput } from "../../components/auth-input";
import { usePatientList } from "../../hooks/use-patient-list";
import { queryMessage } from "../../services/patient-pager";

export default function Patients() {
  const { state, text, setText, reload, more, retry } = usePatientList();
  const hint = queryMessage(state.kind);
  return <Page>
    <Text style={styles.title} accessibilityRole="header">Pacientes</Text>
    <Action title="Nuevo paciente" onPress={() => router.push("/patients/form")} />
    <Text>Buscar paciente</Text>
    <FormInput value={text} onChangeText={setText} accessibilityLabel="Buscar paciente"
      placeholder="Nombre, apellido, correo o teléfono" autoCorrect={false} autoCapitalize="none"
      autoComplete="off" textContentType="none"
      style={{ borderWidth: 1, borderColor: "#526477", borderRadius: 8, padding: 12, minHeight: 44 }} />
    {text !== "" && <Action title="Limpiar búsqueda" variant="quiet" onPress={() => setText("")} />}
    {hint && <Text accessibilityLiveRegion="polite">{hint}</Text>}
    {!hint && <>
      <LoadState loading={state.loading} error={state.items.length ? null : state.error} reload={retry} />
      {!state.loading && !state.error && !state.items.length && <Text style={styles.muted}>
        {state.kind === "all" ? "Aún no tienes pacientes registrados." : "No encontramos pacientes que coincidan con tu búsqueda."}
      </Text>}
      {state.items.map(patient => <Pressable key={patient.id} style={styles.card}
        accessibilityRole="button" accessibilityLabel={`Ver paciente ${patient.firstName} ${patient.lastName}`}
        onPress={() => router.push({ pathname: "/patients/[id]", params: { id: patient.id } })}>
        <Text style={styles.subtitle}>{patient.firstName} {patient.lastName}</Text>
        {patient.phone && <Text style={styles.muted}>{patient.phone}</Text>}
        {patient.email && <Text style={styles.muted}>{patient.email}</Text>}
      </Pressable>)}
      {state.error && state.items.length > 0 && <>
        <Text accessibilityRole="alert">{state.error}</Text>
        <Action title="Reintentar" onPress={() => void retry()} />
      </>}
      {state.nextCursor && <Action title="Cargar más" disabled={state.loading || !!state.error} onPress={() => void more()} />}
      <Action title="Actualizar listado" variant="quiet" disabled={state.loading} onPress={() => void reload()} />
    </>}
  </Page>;
}
