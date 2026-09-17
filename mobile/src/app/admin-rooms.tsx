import { useEffect, useRef, useState } from "react";
import {
  Text,
  TextInput,
  View,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { router } from "expo-router";
import axios from "axios";
import { Action, LoadState, Page, styles } from "../components/booking-ui";
import { useResource } from "../hooks/use-resource";
import { getCurrentUser } from "../services/admin-agenda";
import {
  getManagedRooms,
  saveRoom,
  setRoomActive,
} from "../services/admin-rooms";
import { roomPayload, type RoomForm } from "../services/room-form";
import type { Room } from "../services/rooms";
import { money } from "../services/booking";
import { session } from "../services/api";

export default function AdminRooms() {
  const user = useResource(getCurrentUser);
  if (user.data?.role === "ADMIN") return <Management />;
  return (
    <Page>
      <LoadState {...user} />
      {user.data && (
        <Text>Solo administradores pueden gestionar consultorios.</Text>
      )}
      <Action
        title="Volver al inicio"
        onPress={() => router.replace("/home")}
      />
    </Page>
  );
}

function Management() {
  const rooms = useResource(getManagedRooms);
  const [editing, setEditing] = useState<Room | "new" | null>(null);
  const [toggle, setToggle] = useState<Room | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const flight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function mutate(action: () => Promise<Room>) {
    if (flight.current) return;
    const version = session.getVersion();
    const current = () => mounted.current && session.getVersion() === version;
    flight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (current()) {
        setEditing(null);
        setToggle(null);
        setMessage("Consultorio guardado.");
      }
    } catch (error) {
      if (current()) {
        const status = axios.isAxiosError(error)
          ? error.response?.status
          : undefined;
        setMessage(
          status === 403
            ? "Ya no tienes permiso para gestionar consultorios."
            : status === 400
              ? "Revisa los datos: nombre válido y precio positivo con hasta dos decimales."
              : status === 404
                ? "El consultorio ya no está disponible."
                : "No pudimos verificar el resultado. Revisa la lista antes de volver a crear o modificar el consultorio.",
        );
        // Unknown POST results must be reconciled by reading, not automatically retried.
        if (!status || status >= 500) {
          setEditing(null);
          setToggle(null);
        }
      }
    } finally {
      if (current()) await rooms.reload();
      flight.current = false;
      if (current()) setBusy(false);
    }
  }
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Page>
        <Text style={styles.title}>Gestionar consultorios</Text>
        <Text style={styles.muted}>
          Los nuevos precios se aplican a nuevas reservas. Desactivar conserva
          las reservas existentes.
        </Text>
        {message && <Text accessibilityRole="alert">{message}</Text>}
        {editing ? (
          <RoomEditor
            key={editing === "new" ? "new" : editing.id}
            room={editing === "new" ? null : editing}
            busy={busy}
            cancel={() => setEditing(null)}
            save={(data) =>
              void mutate(() =>
                saveRoom(editing === "new" ? null : editing.id, data),
              )
            }
          />
        ) : (
          <>
            <Action
              title="Crear consultorio"
              disabled={busy || rooms.loading || !!rooms.error}
              onPress={() => {
                setMessage(null);
                setEditing("new");
              }}
            />
            <Action
              title="Actualizar consultorios"
              disabled={busy || rooms.loading}
              onPress={() => void rooms.reload()}
            />
            <LoadState {...rooms} />
            {rooms.data?.length === 0 && <Text>Aún no hay consultorios.</Text>}
            {rooms.data?.map((room) => (
              <View key={room.id} style={styles.card}>
                <Text style={styles.subtitle}>{room.name}</Text>
                <Text>
                  {room.active ? "Activo" : "Inactivo"} ·{" "}
                  {money(room.pricePerHour)} MXN / hora
                </Text>
                <Text>{room.description || "Sin descripción"}</Text>
                <Action
                  title={`Editar ${room.name}`}
                  disabled={busy}
                  onPress={() => {
                    setToggle(null);
                    setMessage(null);
                    setEditing(room);
                  }}
                />
                {toggle?.id === room.id ? (
                  <>
                    <Text>
                      {room.active
                        ? "¿Desactivar este consultorio? Dejará de aceptar nuevas reservas; las existentes se conservan."
                        : "¿Activar este consultorio para aceptar nuevas reservas?"}
                    </Text>
                    <Action
                      title={
                        room.active
                          ? "Confirmar desactivación"
                          : "Confirmar activación"
                      }
                      disabled={busy}
                      onPress={() =>
                        void mutate(() => setRoomActive(room.id, !room.active))
                      }
                    />
                    <Action
                      title="Cancelar"
                      disabled={busy}
                      onPress={() => setToggle(null)}
                    />
                  </>
                ) : (
                  <Action
                    title={room.active ? "Desactivar" : "Activar"}
                    disabled={busy}
                    onPress={() => setToggle(room)}
                  />
                )}
              </View>
            ))}
          </>
        )}
        <Action
          title="Volver al inicio"
          disabled={busy}
          onPress={() => router.replace("/home")}
        />
      </Page>
    </KeyboardAvoidingView>
  );
}

function RoomEditor({
  room,
  busy,
  cancel,
  save,
}: {
  room: Room | null;
  busy: boolean;
  cancel(): void;
  save(data: ReturnType<typeof roomPayload>): void;
}) {
  const [form, setForm] = useState<RoomForm>({
    name: room?.name ?? "",
    description: room?.description ?? "",
    price: room?.pricePerHour ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const change = (field: keyof RoomForm, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));
  const input = {
    borderWidth: 1,
    borderColor: "#526477",
    padding: 12,
    borderRadius: 8,
  };
  function submit() {
    try {
      const data = roomPayload(form);
      setError(null);
      save(data);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }
  return (
    <View style={styles.card}>
      <Text style={styles.subtitle}>
        {room ? "Editar consultorio" : "Nuevo consultorio"}
      </Text>
      <Text>Nombre</Text>
      <TextInput
        accessibilityLabel="Nombre del consultorio"
        style={input}
        value={form.name}
        onChangeText={(v) => change("name", v)}
        maxLength={120}
        editable={!busy}
      />
      <Text>Descripción</Text>
      <TextInput
        accessibilityLabel="Descripción del consultorio"
        style={input}
        value={form.description}
        onChangeText={(v) => change("description", v)}
        maxLength={2000}
        multiline
        editable={!busy}
      />
      <Text>Precio por hora (MXN)</Text>
      <TextInput
        accessibilityLabel="Precio por hora en pesos"
        style={input}
        value={form.price}
        onChangeText={(v) => change("price", v)}
        keyboardType="decimal-pad"
        editable={!busy}
      />
      {error && <Text accessibilityRole="alert">{error}</Text>}
      <Action
        title={busy ? "Guardando…" : "Guardar consultorio"}
        disabled={busy}
        onPress={submit}
      />
      <Action title="Cancelar edición" disabled={busy} onPress={cancel} />
    </View>
  );
}
