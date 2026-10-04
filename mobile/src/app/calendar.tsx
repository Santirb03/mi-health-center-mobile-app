import { useCallback, useState } from "react";
import { Redirect, router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { Action, LoadState, Page, styles } from "../components/booking-ui";
import { useResource } from "../hooks/use-resource";
import { useNow } from "../hooks/use-now";
import { getCurrentUser } from "../services/admin-agenda";
import {
  businessDate,
  formatTime,
  money,
  reservationLabel,
  shiftDate,
} from "../services/booking";
import {
  calendarRange,
  dayLongLabel,
  dayNumber,
  dayShortLabel,
  defaultSelectedDate,
  groupByDay,
  reservationDay,
  weekDates,
  weekRangeLabel,
  weekStart,
} from "../services/calendar";
import { getCalendar, type Reservation } from "../services/reservations";

type Mode = "day" | "week";
const countLabel = (count: number) =>
  `${count} ${count === 1 ? "reserva" : "reservas"}`;

export default function Calendar() {
  const [weekAnchor, setWeekAnchor] = useState(() => weekStart(businessDate()));
  const [mode, setMode] = useState<Mode>("day");
  const [selected, setSelected] = useState(() =>
    defaultSelectedDate(weekAnchor, businessDate()),
  );

  function changeWeek(start: string) {
    setWeekAnchor(start);
    setSelected(defaultSelectedDate(start, businessDate()));
  }

  function goToday() {
    const today = businessDate();
    setWeekAnchor(weekStart(today));
    setSelected(today);
  }

  // A new week gets a fresh resource, immediately hides old data and aborts its read.
  // Mode/day changes keep this same instance and never trigger another weekly read.
  return (
    <CalendarWeek
      key={weekAnchor}
      weekAnchor={weekAnchor}
      mode={mode}
      selected={selected}
      changeWeek={changeWeek}
      goToday={goToday}
      setMode={setMode}
      selectDay={(date) => {
        setSelected(date);
        setMode("day");
      }}
    />
  );
}

function CalendarWeek({
  weekAnchor,
  mode,
  selected,
  changeWeek,
  goToday,
  setMode,
  selectDay,
}: {
  weekAnchor: string;
  mode: Mode;
  selected: string;
  changeWeek(start: string): void;
  goToday(): void;
  setMode(mode: Mode): void;
  selectDay(date: string): void;
}) {
  const { from, to } = calendarRange(weekAnchor);
  const read = useCallback(
    async (signal: AbortSignal) => {
      const user = await getCurrentUser(signal);
      if (signal.aborted) throw new Error("Calendar request cancelled");
      return {
        role: user.role,
        calendar:
          user.role === "DOCTOR" ? await getCalendar(from, to, signal) : null,
      };
    },
    [from, to],
  );
  const resource = useResource(read);
  const now = useNow();
  const today = businessDate(new Date(now));
  const dates = weekDates(weekAnchor);
  const data = resource.data?.calendar;
  const grouped = groupByDay(data?.items ?? [], dates);

  if (resource.data && resource.data.role !== "DOCTOR")
    return <Redirect href="/home" />;

  return (
    <Page>
      <Text accessibilityRole="header" style={styles.title}>
        Calendario
      </Text>
      <Text accessibilityRole="header" style={styles.subtitle}>
        {weekRangeLabel(weekAnchor)}
      </Text>
      <Text style={styles.muted}>
        Horarios de Ciudad de México. Una reserva pendiente todavía no está
        confirmada.
      </Text>
      <View style={styles.row}>
        <Action
          title="Semana anterior"
          variant="secondary"
          onPress={() => changeWeek(shiftDate(weekAnchor, -7))}
        />
        <Action title="Hoy" variant="secondary" onPress={goToday} />
        <Action
          title="Siguiente semana"
          variant="secondary"
          onPress={() => changeWeek(shiftDate(weekAnchor, 7))}
        />
      </View>
      <View style={styles.row}>
        {(["day", "week"] as const).map((option) => (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === option }}
            onPress={() => setMode(option)}
            style={[
              styles.button,
              { flex: 1 },
              mode !== option && { backgroundColor: "#eaf1f8" },
            ]}
          >
            <Text
              style={[
                styles.buttonText,
                mode !== option && { color: "#1765ae" },
              ]}
            >
              {option === "day" ? "Día" : "Semana"}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 3 }}>
        {dates.map((date) => {
          const active = date === selected;
          const isToday = date === today;
          const count = grouped[date].length;
          const color = active ? "white" : "#16324f";
          return (
            <Pressable
              key={date}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${dayLongLabel(date)}${isToday ? ", hoy" : ""}, ${data ? countLabel(count) : "reservas por cargar"}`}
              onPress={() => selectDay(date)}
              style={{
                flex: 1,
                minHeight: 84,
                paddingVertical: 8,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 10,
                gap: 3,
                backgroundColor: active
                  ? "#1765ae"
                  : count > 0
                    ? "#eaf1f8"
                    : "white",
                borderWidth: 2,
                borderColor: isToday ? "#1765ae" : "transparent",
              }}
            >
              <Text style={{ color, fontSize: 13 }}>{dayShortLabel(date)}</Text>
              <Text style={{ color, fontSize: 18, fontWeight: "700" }}>
                {dayNumber(date)}
              </Text>
              <Text style={{ color, fontSize: 12 }}>
                {isToday ? "Hoy" : " "}
              </Text>
              <Text style={{ color, fontSize: 12, fontWeight: "600" }}>
                {data ? count || "—" : "…"}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <LoadState {...resource} />
      {data?.truncated && (
        <View style={styles.card}>
          <Text accessibilityRole="alert">
            Hay más reservas en este periodo de las que se pueden mostrar aquí.
            Consulta «Mis reservas».
          </Text>
          <Action
            title="Mis reservas"
            variant="secondary"
            onPress={() => router.push("/reservations")}
          />
        </View>
      )}
      {data && mode === "day" && (
        <View style={{ gap: 12 }}>
          <Text accessibilityRole="header" style={styles.subtitle}>
            {dayLongLabel(selected)}
          </Text>
          {grouped[selected].length === 0 ? (
            <View style={styles.card}>
              <Text>No tienes reservas este día.</Text>
              <Action
                title="Ver consultorios"
                onPress={() => router.push("/home")}
              />
            </View>
          ) : (
            grouped[selected].map((item) => (
              <ReservationCard key={item.id} item={item} now={now} />
            ))
          )}
        </View>
      )}
      {data &&
        mode === "week" &&
        dates.map((date) => (
          <View key={date} style={{ gap: 10 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${dayLongLabel(date)}, ${countLabel(grouped[date].length)}. Ver día`}
              onPress={() => selectDay(date)}
              style={{ paddingVertical: 12 }}
            >
              <Text style={styles.subtitle}>{dayLongLabel(date)}</Text>
              <Text style={styles.muted}>
                {countLabel(grouped[date].length)}
              </Text>
            </Pressable>
            {grouped[date].length === 0 ? (
              <Text style={styles.muted}>Sin reservas</Text>
            ) : (
              grouped[date].map((item) => (
                <ReservationCard key={item.id} item={item} now={now} compact />
              ))
            )}
          </View>
        ))}
    </Page>
  );
}

function ReservationCard({
  item,
  now,
  compact = false,
}: {
  item: Reservation;
  now: number;
  compact?: boolean;
}) {
  const startDay = reservationDay(item.startTime);
  const endDay = reservationDay(item.endTime);
  return (
    <View style={[styles.card, compact && { padding: 14 }]}>
      <Text style={styles.subtitle}>{item.room?.name || "Consultorio"}</Text>
      <Text>
        {startDay === endDay
          ? `${formatTime(item.startTime)}–${formatTime(item.endTime)}`
          : `${startDay} · ${formatTime(item.startTime)} → ${endDay} · ${formatTime(item.endTime)}`}
      </Text>
      <Text>{reservationLabel(item, now)}</Text>
      {!compact && <Text>{money(item.totalPrice)} MXN</Text>}
      <Action
        title="Ver reserva"
        variant="secondary"
        onPress={() =>
          router.push({
            pathname: "/reservations/[id]",
            params: { id: item.id },
          })
        }
      />
    </View>
  );
}
