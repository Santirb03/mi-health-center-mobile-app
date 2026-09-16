import { useCallback, useState } from "react";
import { router } from "expo-router";
import { Pressable, Text, TextInput, View } from "react-native";
import { Action, LoadState, Page, styles } from "../components/booking-ui";
import { useResource } from "../hooks/use-resource";
import { useNow } from "../hooks/use-now";
import {
  businessDate,
  formatTime,
  money,
  shiftDate,
} from "../services/booking";
import {
  agendaStatusLabels,
  getAgenda,
  getAgendaRooms,
  getCurrentUser,
  type AgendaFilters,
  type AgendaStatus,
} from "../services/admin-agenda";

export default function AdminAgenda() {
  const user = useResource(getCurrentUser);
  if (user.data?.role === "ADMIN") return <Agenda />;
  return (
    <Page>
      <LoadState {...user} />
      {user.data && (
        <Text>
          Esta agenda está disponible únicamente para administradores.
        </Text>
      )}
      <Action
        title="Volver al inicio"
        onPress={() => router.replace("/home")}
      />
    </Page>
  );
}

function Choice({
  title,
  selected,
  onPress,
}: {
  title: string;
  selected: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        borderWidth: 1,
        borderColor: "#1765ae",
        padding: 10,
        borderRadius: 8,
        backgroundColor: selected ? "#1765ae" : "#fff",
      }}
    >
      <Text style={{ color: selected ? "#fff" : "#1765ae" }}>{title}</Text>
    </Pressable>
  );
}

function Agenda() {
  const [filters, setFilters] = useState<AgendaFilters>(() => ({
    date: businessDate(),
    page: 1,
  }));
  const [dateInput, setDateInput] = useState(filters.date);
  const [dateError, setDateError] = useState<string | null>(null);
  const read = useCallback(
    (signal: AbortSignal) => getAgenda(filters, signal),
    [filters],
  );
  const agenda = useResource(read);
  const rooms = useResource(getAgendaRooms);
  const now = useNow();
  function changeDate(date: string) {
    setDateInput(date);
    setDateError(null);
    setFilters((previous) => ({ ...previous, date, page: 1 }));
  }
  function applyDate() {
    const date = dateInput.trim();
    const parsed = new Date(`${date}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    ) {
      setDateError("Escribe una fecha válida: AAAA-MM-DD.");
      return;
    }
    changeDate(date);
  }
  return (
    <Page>
      <Text style={styles.title}>Agenda del administrador</Text>
      <Text style={styles.muted}>
        Horarios de Ciudad de México · {filters.date}
      </Text>
      <View style={styles.card}>
        <Text style={styles.subtitle}>Fecha</Text>
        <TextInput
          accessibilityLabel="Fecha de la agenda, AAAA-MM-DD"
          value={dateInput}
          onChangeText={setDateInput}
          placeholder="AAAA-MM-DD"
          autoCapitalize="none"
          maxLength={10}
          onSubmitEditing={applyDate}
          style={{
            borderWidth: 1,
            borderColor: "#526477",
            padding: 12,
            borderRadius: 8,
          }}
        />
        {dateError && <Text accessibilityRole="alert">{dateError}</Text>}
        <Action title="Consultar fecha" onPress={applyDate} />
        <View style={styles.row}>
          <Choice
            title="Día anterior"
            selected={false}
            onPress={() => changeDate(shiftDate(filters.date, -1))}
          />
          <Choice
            title="Hoy"
            selected={filters.date === businessDate()}
            onPress={() => changeDate(businessDate())}
          />
          <Choice
            title="Día siguiente"
            selected={false}
            onPress={() => changeDate(shiftDate(filters.date, 1))}
          />
        </View>
        <Text style={styles.subtitle}>Consultorio</Text>
        <LoadState {...rooms} />
        <View style={styles.row}>
          <Choice
            title="Todos"
            selected={!filters.roomId}
            onPress={() =>
              setFilters((f) => ({ ...f, roomId: undefined, page: 1 }))
            }
          />
          {rooms.data?.map((room) => (
            <Choice
              key={room.id}
              title={`${room.name}${room.active ? "" : " (inactivo)"}`}
              selected={filters.roomId === room.id}
              onPress={() =>
                setFilters((f) => ({ ...f, roomId: room.id, page: 1 }))
              }
            />
          ))}
        </View>
        <Text style={styles.subtitle}>Estado de la reserva</Text>
        <View style={styles.row}>
          <Choice
            title="Todos"
            selected={!filters.status}
            onPress={() =>
              setFilters((f) => ({ ...f, status: undefined, page: 1 }))
            }
          />
          {(Object.keys(agendaStatusLabels) as AgendaStatus[]).map((status) => (
            <Choice
              key={status}
              title={agendaStatusLabels[status]}
              selected={filters.status === status}
              onPress={() => setFilters((f) => ({ ...f, status, page: 1 }))}
            />
          ))}
        </View>
      </View>
      <Action
        title="Actualizar agenda"
        disabled={agenda.loading}
        onPress={() => void agenda.reload()}
      />
      <LoadState {...agenda} />
      {agenda.data?.items.length === 0 && (
        <Text>No hay reservas para estos filtros en esta página.</Text>
      )}
      {agenda.data?.items.map((item) => {
        const expiredHold =
          item.status === "PENDING" &&
          (!item.expiresAt || Date.parse(item.expiresAt) <= now);
        const status = expiredHold ? "EXPIRED" : item.displayStatus;
        return (
          <View key={item.id} style={styles.card}>
            <Text style={styles.subtitle}>
              {formatTime(item.startTime)}–{formatTime(item.endTime)} ·{" "}
              {item.room.name}
            </Text>
            <Text>
              Médico: {item.doctor.firstName} {item.doctor.lastName}
            </Text>
            <Text>Reserva: {agendaStatusLabels[status]}</Text>
            {expiredHold && (
              <Text style={styles.muted}>
                Retención vencida; sin confirmación del servidor.
              </Text>
            )}
            <Text>
              Pago:{" "}
              {item.payment
                ? {
                    PENDING: "Pendiente",
                    PAID: "Pagado",
                    FAILED: "Fallido",
                    REFUNDED: "Reembolsado",
                  }[item.payment.status]
                : "Sin pago iniciado"}
            </Text>
            <Text>Total: {money(item.totalPrice)} MXN</Text>
            <Text selectable style={styles.muted}>
              Referencia: {item.id}
            </Text>
          </View>
        );
      })}
      <Text>Página {filters.page}</Text>
      <Action
        title="Página anterior"
        disabled={filters.page === 1 || agenda.loading}
        onPress={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
      />
      <Action
        title="Página siguiente"
        disabled={agenda.loading || !agenda.data?.hasMore}
        onPress={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
      />
      <Action
        title="Volver al inicio"
        onPress={() => router.replace("/home")}
      />
    </Page>
  );
}
