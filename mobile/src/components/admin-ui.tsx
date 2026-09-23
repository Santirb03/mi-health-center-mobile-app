import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { Action, styles } from "./booking-ui";
import { businessDate, shiftDate } from "../services/booking";

export const adminSections = [
  {
    route: "/admin-agenda",
    title: "Agenda",
    description: "Consulta las reservas y el estado de sus pagos.",
    symbol: "01",
  },
  {
    route: "/admin-rooms",
    title: "Consultorios",
    description: "Edita espacios, precios y disponibilidad para reservar.",
    symbol: "02",
  },
  {
    route: "/admin-blocks",
    title: "Bloqueos",
    description: "Cierra horarios por mantenimiento u otros motivos.",
    symbol: "03",
  },
] as const;

export function AdminNav({
  current,
  disabled = false,
}: {
  current: string;
  disabled?: boolean;
}) {
  return (
    <View style={adminStyles.navigation}>
      {adminSections.map((section) => (
        <Pressable
          key={section.route}
          accessibilityRole="tab"
          accessibilityState={{ selected: current === section.route, disabled }}
          disabled={disabled}
          onPress={() => router.replace(section.route)}
          style={[
            adminStyles.tab,
            current === section.route && adminStyles.selectedTab,
            disabled && { opacity: 0.5 },
          ]}
        >
          <Text
            style={[
              adminStyles.tabText,
              current === section.route && { color: "#fff" },
            ]}
          >
            {section.title}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Choice({
  title,
  selected,
  onPress,
  disabled = false,
}: {
  title: string;
  selected: boolean;
  onPress(): void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        adminStyles.choice,
        selected && adminStyles.selectedChoice,
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text
        style={{
          color: selected ? "#144f86" : "#526477",
          fontWeight: selected ? "700" : "400",
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function DateNavigator({
  date,
  onChange,
  disabled = false,
}: {
  date: string;
  onChange(date: string): void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(date.slice(0, 7));
  const first = new Date(`${month}-01T12:00:00Z`);
  const start = shiftDate(`${month}-01`, -((first.getUTCDay() + 6) % 7));
  const label = (value: string) =>
    new Intl.DateTimeFormat("es-MX", {
      timeZone: "UTC",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(`${value}T12:00:00Z`));
  const select = (value: string) => {
    onChange(value);
    setOpen(false);
  };
  const moveMonth = (step: number) => {
    const value = new Date(`${month}-01T12:00:00Z`);
    value.setUTCMonth(value.getUTCMonth() + step);
    setMonth(value.toISOString().slice(0, 7));
  };
  return (
    <>
      <View style={adminStyles.dateBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Día anterior"
          disabled={disabled}
          onPress={() => onChange(shiftDate(date, -1))}
          style={adminStyles.arrow}
        >
          <Text style={adminStyles.arrowText}>‹</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Cambiar fecha: ${label(date)}`}
          disabled={disabled}
          onPress={() => {
            setMonth(date.slice(0, 7));
            setOpen(true);
          }}
          style={{ flex: 1, alignItems: "center", paddingVertical: 10 }}
        >
          <Text style={styles.subtitle}>
            {date === businessDate()
              ? "Hoy"
              : new Intl.DateTimeFormat("es-MX", {
                  weekday: "long",
                  timeZone: "UTC",
                }).format(new Date(`${date}T12:00:00Z`))}
          </Text>
          <Text style={styles.muted}>{label(date)} ▾</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Día siguiente"
          disabled={disabled}
          onPress={() => onChange(shiftDate(date, 1))}
          style={adminStyles.arrow}
        >
          <Text style={adminStyles.arrowText}>›</Text>
        </Pressable>
      </View>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={adminStyles.overlay}>
          <View accessibilityViewIsModal style={adminStyles.calendar}>
            <ScrollView contentContainerStyle={{ gap: 12 }}>
              <Text style={styles.subtitle}>Elegir fecha</Text>
              <View style={adminStyles.dateBar}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Mes anterior"
                  onPress={() => moveMonth(-1)}
                  style={adminStyles.arrow}
                >
                  <Text style={adminStyles.arrowText}>‹</Text>
                </Pressable>
                <Text
                  style={[styles.subtitle, { flex: 1, textAlign: "center" }]}
                >
                  {new Intl.DateTimeFormat("es-MX", {
                    month: "long",
                    year: "numeric",
                    timeZone: "UTC",
                  }).format(first)}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Mes siguiente"
                  onPress={() => moveMonth(1)}
                  style={adminStyles.arrow}
                >
                  <Text style={adminStyles.arrowText}>›</Text>
                </Pressable>
              </View>
              <View style={adminStyles.calendarGrid}>
                {["L", "M", "M", "J", "V", "S", "D"].map((day, i) => (
                  <Text key={i} style={adminStyles.weekday}>
                    {day}
                  </Text>
                ))}
                {Array.from({ length: 42 }, (_, i) => shiftDate(start, i)).map(
                  (day) => (
                    <Pressable
                      key={day}
                      accessibilityRole="button"
                      accessibilityLabel={label(day)}
                      accessibilityState={{ selected: day === date }}
                      onPress={() => select(day)}
                      style={[
                        adminStyles.day,
                        day === date && adminStyles.selectedTab,
                      ]}
                    >
                      <Text
                        style={{
                          color:
                            day === date
                              ? "#fff"
                              : day.startsWith(month)
                                ? "#16324f"
                                : "#728296",
                        }}
                      >
                        {Number(day.slice(-2))}
                      </Text>
                    </Pressable>
                  ),
                )}
              </View>
              <Action
                title="Ir a hoy"
                variant="secondary"
                onPress={() => select(businessDate())}
              />
              <Action
                title="Cerrar calendario"
                variant="quiet"
                onPress={() => setOpen(false)}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

export const adminStyles = StyleSheet.create({
  navigation: {
    flexDirection: "row",
    backgroundColor: "#e9eef4",
    borderRadius: 14,
    padding: 4,
    gap: 2,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  selectedTab: { backgroundColor: "#163f64", borderRadius: 10 },
  tabText: { color: "#526477", fontWeight: "600", fontSize: 13 },
  choice: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 22,
    backgroundColor: "#f0f3f7",
    borderWidth: 1,
    borderColor: "#e4eaf1",
  },
  selectedChoice: { backgroundColor: "#e1eefb", borderColor: "#1765ae" },
  dateBar: { flexDirection: "row", alignItems: "center", gap: 4 },
  arrow: {
    width: 44,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  arrowText: { color: "#1765ae", fontSize: 30 },
  overlay: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "#10283eb3",
    padding: 16,
  },
  calendar: {
    backgroundColor: "white",
    borderRadius: 20,
    padding: 16,
    maxHeight: "90%",
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
  },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap" },
  weekday: {
    width: "14.2857%",
    textAlign: "center",
    paddingVertical: 10,
    color: "#526477",
  },
  day: {
    width: "14.2857%",
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
