import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { AuthInput as FormInput } from "./auth-input";
import { useFocusEffect } from "expo-router";
import axios from "axios";
import { Action, LoadState, styles } from "./booking-ui";
import { useResource } from "../hooks/use-resource";
import { businessDate, formatTime } from "../services/booking";
import { blockErrors, blockInput, blocksOnDate } from "../services/block-form";
import {
  createRoomBlock,
  getRoomBlocks,
  removeRoomBlock,
  type RoomBlock,
} from "../services/room-blocks";
import type { AgendaRoom } from "../services/admin-agenda";
import { session } from "../services/api";

export function RoomBlocksPanel({
  room,
  date,
  onBusyChange,
}: {
  room: AgendaRoom;
  date: string;
  onBusyChange?(busy: boolean): void;
}) {
  const read = useCallback(
    (signal: AbortSignal) => {
      setRemoving(null);
      return getRoomBlocks(room.id, signal);
    },
    [room.id],
  );
  const blocks = useResource(read);
  const [start, setStart] = useState("08");
  const [end, setEnd] = useState("09");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [creating, setCreating] = useState(false);
  const errors = submitted ? blockErrors(date, start, end, reason) : {};
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<RoomBlock | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const active = useRef(false);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      return () => {
        active.current = false;
      };
    }, []),
  );

  async function mutate(action: "create" | "remove", block?: RoomBlock) {
    if (inFlight.current || blocks.loading || blocks.error) return;
    let input;
    if (action === "create") {
      if (!room.active) return;
      setSubmitted(true);
      setMessage(null);
      if (Object.keys(blockErrors(date, start, end, reason)).length) return;
      try {
        input = blockInput(date, start, end, reason);
      } catch (error) {
        setMessage((error as Error).message);
        return;
      }
    }
    const version = session.getVersion();
    const current = () => active.current && session.getVersion() === version;
    inFlight.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setMessage(null);
    try {
      if (input) await createRoomBlock(room.id, input);
      else if (block) await removeRoomBlock(room.id, block.id);
      if (current()) {
        setMessage(input ? "Bloqueo creado." : "Bloqueo retirado.");
        setRemoving(null);
        if (input) {
          setReason("");
          setSubmitted(false);
          setCreating(false);
        }
      }
    } catch (error) {
      if (current()) {
        const status = axios.isAxiosError(error)
          ? error.response?.status
          : undefined;
        setMessage(
          status === 403
            ? "Ya no tienes permiso para gestionar bloqueos."
            : status === 400
              ? "No se pudo crear el bloqueo: revisa el horario; puede existir una reserva vigente u otro bloqueo."
              : status === 404
                ? "El consultorio o bloqueo ya no está disponible. La lista se actualizará."
                : "No pudimos verificar el resultado. Revisa la lista actualizada antes de volver a intentar.",
        );
        setRemoving(null);
      }
    } finally {
      if (current()) await blocks.reload();
      inFlight.current = false;
      onBusyChange?.(false);
      if (mounted.current && session.getVersion() === version) setBusy(false);
    }
  }
  const inputStyle = {
    borderWidth: 1,
    borderColor: "#526477",
    padding: 12,
    borderRadius: 8,
  };
  return (
    <View style={styles.card}>
      <Text style={styles.subtitle}>Horarios bloqueados · {room.name}</Text>
      <Text style={styles.muted}>
        Consulta los bloqueos del día o agrega uno nuevo.
      </Text>
      <LoadState {...blocks} />
      {message && <Text accessibilityRole="alert">{message}</Text>}
      <Action
        title={blocks.loading ? "Cargando bloqueos…" : "Actualizar bloqueos"}
        variant="quiet"
        disabled={busy || blocks.loading}
        onPress={() => void blocks.reload()}
      />
      {blocks.data && blocksOnDate(blocks.data, date).length === 0 && (
        <Text style={styles.muted}>
          No hay bloqueos este día. La disponibilidad depende de las reservas
          existentes.
        </Text>
      )}
      {blocks.data &&
        blocksOnDate(blocks.data, date).map((block) => (
          <View key={block.id} style={{ gap: 8, paddingVertical: 12 }}>
            <Text>
              {businessDate(new Date(block.startTime))}{" "}
              {formatTime(block.startTime)} →{" "}
              {businessDate(new Date(block.endTime))}{" "}
              {formatTime(block.endTime)}
            </Text>
            <Text>{block.reason || "Sin motivo indicado"}</Text>
            {removing?.id === block.id ? (
              <>
                <Text>
                  ¿Retirar este bloqueo? El horario quedará sujeto a la
                  disponibilidad de reservas.
                </Text>
                <Action
                  title={busy ? "Retirando bloqueo…" : "Confirmar retiro"}
                  disabled={busy}
                  onPress={() => void mutate("remove", block)}
                />
                <Action
                  title="Conservar bloqueo"
                  variant="quiet"
                  disabled={busy}
                  onPress={() => setRemoving(null)}
                />
              </>
            ) : (
              <Action
                title="Retirar bloqueo"
                variant="danger"
                disabled={busy || blocks.loading}
                onPress={() => setRemoving(block)}
              />
            )}
          </View>
        ))}
      {room.active && !creating && (
        <Action
          title="Bloquear un horario"
          disabled={busy || blocks.loading || !!blocks.error || !!removing}
          onPress={() => {
            setCreating(true);
            setMessage(null);
          }}
        />
      )}
      {room.active && creating ? (
        <>
          <Text style={styles.subtitle}>Nuevo bloqueo</Text>
          <Text style={styles.muted}>
            Elige las horas en formato de 24 horas. No modifica reservas
            existentes.
          </Text>
          {errors.date && <Text accessibilityRole="alert">{errors.date}</Text>}
          <Text>Hora de inicio (08–20)</Text>
          <FormInput
            error={errors.start}
            accessibilityLabel="Hora de inicio del bloqueo"
            style={inputStyle}
            value={start}
            onChangeText={setStart}
            keyboardType="number-pad"
            maxLength={2}
            editable={!busy}
          />
          <Text>Hora de fin (09–21)</Text>
          <FormInput
            error={errors.end}
            accessibilityLabel="Hora de fin del bloqueo"
            style={inputStyle}
            value={end}
            onChangeText={setEnd}
            keyboardType="number-pad"
            maxLength={2}
            editable={!busy}
          />
          <Text>Motivo (opcional)</Text>
          <FormInput
            error={errors.reason}
            accessibilityLabel="Motivo del bloqueo"
            style={inputStyle}
            value={reason}
            onChangeText={setReason}
            maxLength={500}
            editable={!busy}
          />
          <Action
            title={busy && !removing ? "Guardando…" : "Confirmar bloqueo"}
            disabled={busy || blocks.loading || !!blocks.error || !!removing}
            onPress={() => void mutate("create")}
          />
          <Action
            title="Cancelar"
            variant="quiet"
            disabled={busy}
            onPress={() => {
              setCreating(false);
              setSubmitted(false);
              setReason("");
              setMessage(null);
            }}
          />
        </>
      ) : !room.active ? (
        <Text>
          El consultorio está inactivo. Puedes consultar y retirar sus bloqueos.
        </Text>
      ) : null}
    </View>
  );
}
