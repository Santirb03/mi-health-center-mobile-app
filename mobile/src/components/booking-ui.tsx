import type { PropsWithChildren } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export function Page({ children }: PropsWithChildren) {
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: "#f7f8fa" }}
      edges={["bottom", "left", "right"]}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.page}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Action({
  title,
  onPress,
  disabled = false,
  variant = "primary",
}: {
  title: string;
  onPress(): void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "quiet" | "danger";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        variant === "secondary" && { backgroundColor: "#eaf1f8" },
        variant === "quiet" && { backgroundColor: "transparent" },
        variant === "danger" && { backgroundColor: "#fff0ed" },
        disabled && { opacity: 0.45 },
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          (variant === "secondary" || variant === "quiet") && {
            color: "#1765ae",
          },
          variant === "danger" && { color: "#a12b20" },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function LoadState({
  loading,
  error,
  reload,
}: {
  loading: boolean;
  error: string | null;
  reload(): Promise<void>;
}) {
  return (
    <>
      {loading && <ActivityIndicator accessibilityLabel="Cargando" />}
      {error && (
        <>
          <Text accessibilityRole="alert">{error}</Text>
          <Action title="Reintentar" onPress={() => void reload()} />
        </>
      )}
    </>
  );
}

export const styles = StyleSheet.create({
  page: { padding: 20, gap: 16, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: "700", color: "#16324f" },
  subtitle: { fontSize: 18, fontWeight: "600", color: "#16324f" },
  card: { padding: 18, borderRadius: 14, backgroundColor: "white", gap: 10 },
  muted: { color: "#526477", fontSize: 15, lineHeight: 22 },
  button: {
    padding: 15,
    borderRadius: 10,
    backgroundColor: "#1765ae",
    alignItems: "center",
  },
  buttonText: { color: "white", fontWeight: "600", fontSize: 16 },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "center",
  },
});
