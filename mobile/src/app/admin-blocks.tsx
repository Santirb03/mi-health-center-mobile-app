import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { router } from "expo-router";
import { Action, LoadState, Page, styles } from "../components/booking-ui";
import { AdminNav, Choice, DateNavigator } from "../components/admin-ui";
import { RoomBlocksPanel } from "../components/room-blocks-panel";
import { getAgendaRooms, getCurrentUser } from "../services/admin-agenda";
import { businessDate } from "../services/booking";
import { useResource } from "../hooks/use-resource";

export default function AdminBlocks() {
  const user = useResource(getCurrentUser);
  if (user.data?.role === "ADMIN") return <Blocks />;
  return (
    <Page>
      <LoadState {...user} />
      {user.data && (
        <Text>Solo administradores pueden gestionar bloqueos.</Text>
      )}
      <Action
        title="Volver al inicio"
        onPress={() => router.replace("/home")}
      />
    </Page>
  );
}

function Blocks() {
  const rooms = useResource(getAgendaRooms);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [date, setDate] = useState(businessDate);
  const [busy, setBusy] = useState(false);
  const room = rooms.data?.find((item) => item.id === roomId);
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Page>
        <AdminNav current="/admin-blocks" disabled={busy} />
        <View style={{ gap: 6 }}>
          <Text style={styles.title}>Bloqueos de horario</Text>
          <Text style={styles.muted}>
            Impide nuevas reservas en un horario específico.
          </Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.subtitle}>1. Elige un consultorio</Text>
          <LoadState {...rooms} />
          <View style={styles.row}>
            {rooms.data?.map((item) => (
              <Choice
                key={item.id}
                title={`${item.name}${item.active ? "" : " · Inactivo"}`}
                selected={roomId === item.id}
                disabled={busy}
                onPress={() => setRoomId(item.id)}
              />
            ))}
          </View>
          {rooms.data?.length === 0 && (
            <Text style={styles.muted}>
              Primero crea un consultorio en la sección Consultorios.
            </Text>
          )}
        </View>
        {room ? (
          <>
            <View style={styles.card}>
              <Text style={styles.subtitle}>2. Elige el día</Text>
              <DateNavigator date={date} onChange={setDate} disabled={busy} />
              <Text style={styles.muted}>Horarios de Ciudad de México</Text>
            </View>
            <RoomBlocksPanel
              key={`${room.id}:${date}`}
              room={room}
              date={date}
              onBusyChange={setBusy}
            />
          </>
        ) : rooms.data && rooms.data.length > 0 ? (
          <Text style={styles.muted}>
            Selecciona un consultorio para ver sus horarios bloqueados.
          </Text>
        ) : null}
      </Page>
    </KeyboardAvoidingView>
  );
}
