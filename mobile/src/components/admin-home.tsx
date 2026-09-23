import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useSession } from "../providers/session-provider";
import { adminSections } from "./admin-ui";
import { Action, styles } from "./booking-ui";

export function AdminHome() {
  const { signOut } = useSession();
  function logout() {
    Alert.alert(
      "Cerrar sesión",
      "¿Quieres salir de tu cuenta de administrador?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Cerrar sesión",
          style: "destructive",
          onPress: () => {
            void signOut().catch(() =>
              Alert.alert(
                "No pudimos cerrar sesión",
                "Intenta de nuevo cuando tengas conexión.",
              ),
            );
          },
        },
      ],
    );
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#f7f8fa" }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 24 }}>
        <View style={{ gap: 8, paddingTop: 12 }}>
          <Text
            style={{
              color: "#1765ae",
              fontWeight: "700",
              fontSize: 13,
              letterSpacing: 1,
            }}
          >
            MI HEALTH CENTER
          </Text>
          <Text style={[styles.title, { fontSize: 30 }]}>Administración</Text>
          <Text style={styles.muted}>¿Qué necesitas hacer?</Text>
        </View>
        {adminSections.map((section, index) => (
          <Pressable
            key={section.route}
            accessibilityRole="button"
            accessibilityLabel={`${section.title}. ${section.description}`}
            onPress={() => router.push(section.route)}
            style={({ pressed }) => ({
              backgroundColor: index === 0 ? "#163f64" : "white",
              borderRadius: 20,
              padding: 24,
              gap: 14,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  color: index === 0 ? "#bdd8ed" : "#526477",
                  fontSize: 13,
                  fontWeight: "600",
                }}
              >
                {section.symbol}
              </Text>
              <Text
                accessible={false}
                style={{
                  color: index === 0 ? "white" : "#1765ae",
                  fontSize: 22,
                }}
              >
                →
              </Text>
            </View>
            <Text
              style={{
                fontSize: 23,
                fontWeight: "700",
                color: index === 0 ? "white" : "#16324f",
              }}
            >
              {section.title}
            </Text>
            <Text
              style={{
                fontSize: 16,
                lineHeight: 24,
                color: index === 0 ? "#e1edf6" : "#526477",
              }}
            >
              {section.description}
            </Text>
          </Pressable>
        ))}
        <Action title="Cerrar sesión" variant="quiet" onPress={logout} />
      </ScrollView>
    </SafeAreaView>
  );
}
