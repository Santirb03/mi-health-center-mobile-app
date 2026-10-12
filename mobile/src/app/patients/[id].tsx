import axios from "axios";
import { useCallback, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Text } from "react-native";
import { Page, Action, LoadState, styles } from "../../components/booking-ui";
import { usePatientIdentity } from "../../hooks/use-patient-list";
import { useResource } from "../../hooks/use-resource";
import { session } from "../../services/api";
import { getPatient } from "../../services/patients";
import { formatCivilDate } from "../../services/patient-form";

export default function PatientDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const version = usePatientIdentity();
  if (!session.getTokens()) return null;
  return <Detail key={`${version}:${id}`} id={typeof id === "string" ? id : ""} version={version} />;
}
function Detail({ id, version }: { id: string; version: number }) {
  const [missing, setMissing] = useState(!id);
  const read = useCallback(async (signal: AbortSignal) => {
    if (!id) throw new Error("Missing patient ID");
    try { return await getPatient(id, signal); }
    catch (error) {
      if (!signal.aborted && session.getVersion() === version && axios.isAxiosError(error) && error.response?.status === 404)
        setMissing(true);
      throw error;
    }
  }, [id, version]);
  const resource = useResource(read);
  const patient = resource.data;
  return <Page>
    <Text style={styles.title} accessibilityRole="header">Paciente</Text>
    {missing ? <Text accessibilityRole="alert">Este paciente ya no está disponible.</Text> : <>
      <LoadState {...resource} />
      {patient && <>
        <Text style={styles.subtitle}>{patient.firstName} {patient.lastName}</Text>
        {patient.phone && <Text>Teléfono: {patient.phone}</Text>}
        {patient.email && <Text>Correo: {patient.email}</Text>}
        {patient.dateOfBirth && <Text>Nacimiento: {formatCivilDate(patient.dateOfBirth)}</Text>}
        <Action title="Editar" onPress={() => router.push({ pathname: "/patients/form", params: { id: patient.id } })} />
      </>}
    </>}
    <Action title="Volver a pacientes" variant="secondary" onPress={() => router.replace("/patients")} />
  </Page>;
}
