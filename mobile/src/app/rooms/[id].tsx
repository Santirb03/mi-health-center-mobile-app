import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import axios from "axios";
import { Action, LoadState, Page, styles } from "../../components/booking-ui";
import { useResource } from "../../hooks/use-resource";
import { useNow } from "../../hooks/use-now";
import { getAvailability, getRoom } from "../../services/rooms";
import {
  createReservation,
  getReservations,
} from "../../services/reservations";
import {
  businessDate,
  matchingReservation,
  money,
  selectable,
  selectedRange,
  shiftDate,
} from "../../services/booking";
import { session } from "../../services/api";

export default function RoomDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const now = useNow();
  const [date, setDate] = useState(() => businessDate());
  const [start, setStart] = useState(-1);
  const [end, setEnd] = useState(-1);
  const [review, setReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const sending = useRef(false);
  const mounted = useRef(true);
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
      };
    }, []),
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const read = useCallback(
    async (signal: AbortSignal) => {
      setStart(-1);
      setEnd(-1);
      setReview(false);
      const room = await getRoom(id, signal);
      if (!room.active) throw new Error("Inactive room");
      const availability = await getAvailability(id, date, signal);
      return { room, availability };
    },
    [id, date],
  );
  const resource = useResource(read);
  const ready =
    resource.data?.availability.date === date && resource.data?.room.id === id;
  const range = selectedRange(
    ready ? resource.data!.availability.slots : [],
    start,
    end,
    now,
  );

  function select(index: number) {
    const slots = resource.data?.availability.slots ?? [];
    const extended = selectedRange(slots, start, index, Date.now());
    if (start >= 0 && index > start && extended.length) setEnd(index);
    else {
      setStart(index);
      setEnd(index);
    }
    setReview(false);
    setMessage(null);
  }

  async function submit() {
    if (sending.current || uncertain || !resource.data || !ready) return;
    const selected = selectedRange(
      resource.data.availability.slots,
      start,
      end,
      Date.now(),
    );
    if (!selected.length) {
      setReview(false);
      return;
    }
    const input = {
      roomId: id,
      startTime: selected[0].startDateTime,
      endTime: selected[selected.length - 1].endDateTime,
    };
    const version = session.getVersion();
    const current = () => mounted.current && session.getVersion() === version;
    sending.current = true;
    setSubmitting(true);
    setMessage(null);
    try {
      const reservation = await createReservation(input);
      if (current() && focused.current)
        router.replace({
          pathname: "/reservations/[id]",
          params: { id: reservation.id },
        });
    } catch (failure) {
      if (!current()) return;
      const status = axios.isAxiosError(failure)
        ? failure.response?.status
        : undefined;
      if (status && status >= 400 && status < 500) {
        setMessage(
          status === 400 || status === 409
            ? "El horario ya no se puede reservar. Actualizamos la disponibilidad; elige otro intervalo."
            : "No pudimos crear la reserva. Verifica tu sesión e intenta más tarde.",
        );
        await resource.reload();
      } else {
        // The POST may have committed. Only reconcile with a GET, never resend it.
        setUncertain(true);
        setMessage(
          "No pudimos confirmar el resultado. Revisa Mis reservas antes de intentar una nueva reserva.",
        );
        try {
          const found = matchingReservation(await getReservations(), input);
          if (found && current() && focused.current)
            router.replace({
              pathname: "/reservations/[id]",
              params: { id: found.id },
            });
        } catch {
          /* Keep the uncertain state and offer the reservation list. */
        }
      }
    } finally {
      sending.current = false;
      if (current()) setSubmitting(false);
    }
  }

  return (
    <Page>
      <LoadState {...resource} />
      {message && <Text accessibilityRole="alert">{message}</Text>}
      {uncertain && (
        <Action
          title="Revisar Mis reservas"
          onPress={() => router.replace("/reservations")}
        />
      )}
      {resource.data && (
        <>
          <Text style={styles.title}>{resource.data.room.name}</Text>
          <Text style={styles.muted}>
            {resource.data.room.description ||
              "Consultorio disponible para tu práctica médica."}
          </Text>
          <Text style={styles.subtitle}>
            {money(resource.data.room.pricePerHour)} MXN / hora
          </Text>
          <Text style={styles.muted}>
            Horarios de Ciudad de México · 08:00 a 21:00
          </Text>
          <View style={styles.row}>
            <Action
              title="Día anterior"
              disabled={
                date <= businessDate(new Date(now)) || submitting || uncertain
              }
              onPress={() => setDate(shiftDate(date, -1))}
            />
            <Action
              title="Día siguiente"
              disabled={submitting || uncertain}
              onPress={() => setDate(shiftDate(date, 1))}
            />
          </View>
          <Text style={styles.subtitle}>Fecha: {date}</Text>
          <Action
            title="Actualizar horarios"
            disabled={submitting || uncertain || resource.loading}
            onPress={() => void resource.reload()}
          />
          <Text style={styles.muted}>
            Selecciona la primera hora y después la última para reservar varias
            horas consecutivas.
          </Text>
          <View style={styles.row}>
            {resource.data.availability.slots.map((slot, index) => {
              const available = selectable(slot, now);
              const selected =
                range.length > 0 && index >= start && index <= end;
              return (
                <Pressable
                  key={slot.startDateTime}
                  accessibilityRole="button"
                  accessibilityLabel={`${slot.startTime} a ${slot.endTime}, ${available ? "disponible" : "no disponible"}`}
                  accessibilityState={{
                    selected,
                    disabled: !available || submitting || uncertain,
                  }}
                  disabled={!available || submitting || uncertain}
                  onPress={() => select(index)}
                  style={{
                    padding: 14,
                    borderRadius: 10,
                    borderWidth: 2,
                    borderColor: selected ? "#1765ae" : "#d9e0e7",
                    backgroundColor: selected
                      ? "#dfedfb"
                      : available
                        ? "white"
                        : "#e8ebee",
                  }}
                >
                  <Text style={{ color: available ? "#16324f" : "#626b74" }}>
                    {slot.startTime}–{slot.endTime}
                  </Text>
                  <Text>
                    {available
                      ? selected
                        ? "Seleccionado"
                        : "Disponible"
                      : "No disponible"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {!resource.data.availability.slots.some((slot) =>
            selectable(slot, now),
          ) && <Text>No hay horarios disponibles para esta fecha.</Text>}
          {!!range.length && (
            <View style={styles.card}>
              <Text style={styles.subtitle}>
                {range[0].startTime}–{range[range.length - 1].endTime} ·{" "}
                {range.length} h
              </Text>
              <Text>
                Total estimado:{" "}
                {money(Number(resource.data.room.pricePerHour) * range.length)}{" "}
                MXN
              </Text>
              <Text style={styles.muted}>
                El servidor calcula el precio definitivo al crear la reserva.
              </Text>
              {review ? (
                <>
                  <Text>
                    Se creará una retención de hasta 8 minutos, pendiente de
                    pago. Esta versión todavía no permite pagar y no confirma el
                    consultorio.
                  </Text>
                  <Action
                    title={
                      submitting
                        ? "Creando reserva..."
                        : "Crear reserva pendiente"
                    }
                    disabled={submitting || uncertain}
                    onPress={() => void submit()}
                  />
                </>
              ) : (
                <Action
                  title="Revisar reserva"
                  disabled={submitting || uncertain}
                  onPress={() => setReview(true)}
                />
              )}
            </View>
          )}
        </>
      )}
      <Action
        title="Mis reservas"
        disabled={submitting}
        onPress={() => router.push("/reservations")}
      />
    </Page>
  );
}
