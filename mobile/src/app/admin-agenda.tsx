import { useCallback, useState } from "react";
import { router } from "expo-router";
import { Text, View } from "react-native";
import { Action, LoadState, Page, styles } from "../components/booking-ui";
import { useResource } from "../hooks/use-resource";
import { useNow } from "../hooks/use-now";
import { AdminNav, Choice, DateNavigator } from "../components/admin-ui";
import { businessDate, formatTime, money } from "../services/booking";
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

function Agenda() {
  const [filters, setFilters] = useState<AgendaFilters>(() => ({
    date: businessDate(),
    page: 1,
  }));
  const [showFilters, setShowFilters] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const filterKey = JSON.stringify([
    filters.date,
    filters.roomId,
    filters.status,
    filters.page,
  ]);
  const read = useCallback(
    async (signal: AbortSignal) => ({
      page: await getAgenda(filters, signal),
      filterKey,
    }),
    [filters, filterKey],
  );
  const agenda = useResource(read);
  const page = agenda.data?.filterKey === filterKey ? agenda.data.page : null;
  const rooms = useResource(getAgendaRooms);
  const now = useNow();
  const selectedRoom = rooms.data?.find((room) => room.id === filters.roomId);
  const activeFilters = Number(!!filters.roomId) + Number(!!filters.status);
  function clearFilters() {
    setFilters({ date: filters.date, page: 1 });
  }
  return (
    <Page>
      <AdminNav current="/admin-agenda" />
      <View style={{ gap: 6 }}>
        <Text style={styles.title}>Agenda</Text>
        <Text style={styles.muted}>Reservas y pagos, organizados por día.</Text>
      </View>
      <View style={styles.card}>
        <DateNavigator
          date={filters.date}
          onChange={(date) => setFilters((f) => ({ ...f, date, page: 1 }))}
        />
        <Text style={[styles.muted, { textAlign: "center" }]}>
          Horarios de Ciudad de México
        </Text>
      </View>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Action
            title={
              showFilters
                ? "Cerrar filtros"
                : `Filtros${activeFilters ? ` · ${activeFilters}` : ""}`
            }
            variant="secondary"
            onPress={() => setShowFilters((value) => !value)}
          />
        </View>
        <Action
          title={agenda.loading ? "Actualizando…" : "Actualizar"}
          variant="quiet"
          disabled={agenda.loading}
          onPress={() => void agenda.reload()}
        />
      </View>
      {activeFilters > 0 && (
        <Text style={styles.muted}>
          {selectedRoom?.name ??
            (filters.roomId
              ? "Consultorio seleccionado"
              : "Todos los consultorios")}{" "}
          ·{" "}
          {filters.status
            ? agendaStatusLabels[filters.status]
            : "Todos los estados"}
        </Text>
      )}
      {showFilters && (
        <View style={styles.card}>
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
            {(Object.keys(agendaStatusLabels) as AgendaStatus[]).map(
              (status) => (
                <Choice
                  key={status}
                  title={agendaStatusLabels[status]}
                  selected={filters.status === status}
                  onPress={() => setFilters((f) => ({ ...f, status, page: 1 }))}
                />
              ),
            )}
          </View>
          {activeFilters > 0 && (
            <Action
              title="Limpiar filtros"
              variant="quiet"
              onPress={clearFilters}
            />
          )}
        </View>
      )}
      <LoadState {...agenda} />
      {page?.items.length === 0 && (
        <View style={styles.card}>
          <Text>No hay reservas para esta consulta.</Text>
          <Text style={styles.muted}>
            Puedes elegir otro día o revisar los filtros.
          </Text>
          {activeFilters > 0 && (
            <Action
              title="Ver todos los consultorios y estados"
              variant="secondary"
              onPress={clearFilters}
            />
          )}
        </View>
      )}
      {page && page.items.length > 0 && (
        <Text style={styles.muted}>
          {page.items.length} {page.items.length === 1 ? "reserva" : "reservas"}{" "}
          en esta página
        </Text>
      )}
      {page?.items.map((item) => {
        const expiredHold =
          item.status === "PENDING" &&
          (!item.expiresAt || Date.parse(item.expiresAt) <= now);
        const status = expiredHold ? "EXPIRED" : item.displayStatus;
        return (
          <View key={item.id} style={styles.card}>
            <View style={[styles.row, { justifyContent: "space-between" }]}>
              <Text style={styles.subtitle}>
                {formatTime(item.startTime)}–{formatTime(item.endTime)}
              </Text>
              <Text
                style={{
                  color:
                    status === "CONFIRMED"
                      ? "#166246"
                      : status === "PENDING"
                        ? "#855207"
                        : "#526477",
                  backgroundColor:
                    status === "CONFIRMED"
                      ? "#e5f4ec"
                      : status === "PENDING"
                        ? "#fff2d8"
                        : "#f0f3f7",
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 8,
                  fontWeight: "600",
                }}
              >
                {agendaStatusLabels[status]}
              </Text>
            </View>
            <Text style={styles.subtitle}>{item.room.name}</Text>
            <Text>
              Médico: {item.doctor.firstName} {item.doctor.lastName}
            </Text>
            {expiredHold && (
              <Text style={styles.muted}>
                El tiempo para completar el pago terminó. Actualiza para
                consultar el estado más reciente.
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
            <Action
              title={
                expandedId === item.id ? "Ocultar referencia" : "Ver referencia"
              }
              variant="quiet"
              onPress={() =>
                setExpandedId((current) =>
                  current === item.id ? null : item.id,
                )
              }
            />
            {expandedId === item.id && (
              <Text selectable style={styles.muted}>
                Referencia: {item.id}
              </Text>
            )}
          </View>
        );
      })}
      {(filters.page > 1 || page?.hasMore) && (
        <View style={styles.card}>
          <Text style={styles.muted}>Página {filters.page}</Text>
          <View style={styles.row}>
            <Action
              title="Anterior"
              variant="secondary"
              disabled={filters.page === 1 || agenda.loading}
              onPress={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
            />
            <Action
              title="Siguiente"
              variant="secondary"
              disabled={agenda.loading || !page?.hasMore}
              onPress={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
            />
          </View>
        </View>
      )}
    </Page>
  );
}
