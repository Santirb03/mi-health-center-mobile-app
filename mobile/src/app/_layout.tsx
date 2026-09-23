import { Stack } from "expo-router";
import { ActivityIndicator, Alert, Button, Text, View } from "react-native";
import { SessionProvider, useSession } from "../providers/session-provider";
import { PaymentProvider } from "../providers/payment-provider";

export default function RootLayout() {
  return (
    <SessionProvider>
      <PaymentProvider>
        <SessionNavigator />
      </PaymentProvider>
    </SessionProvider>
  );
}

function SessionNavigator() {
  const { authenticated, loading, error, retry, signOut } = useSession();
  if (loading || error) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
          gap: 16,
        }}
      >
        {loading ? (
          <>
            <ActivityIndicator size="large" />
            <Text>Recuperando tu sesión...</Text>
          </>
        ) : (
          <>
            <Text accessibilityRole="alert">{error}</Text>
            <Button
              title="Reintentar"
              onPress={() => {
                void retry();
              }}
            />
            <Button
              title="Volver al inicio de sesión"
              onPress={() => {
                void signOut().catch(() =>
                  Alert.alert(
                    "Cerrar sesión",
                    "No pudimos completar el cierre de sesión. Intenta de nuevo.",
                  ),
                );
              }}
            />
          </>
        )}
      </View>
    );
  }
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={authenticated}>
        <Stack.Screen name="home" />
        <Stack.Screen
          name="admin-rooms"
          options={{ headerShown: true, title: "Administración" }}
        />
        <Stack.Screen
          name="admin-agenda"
          options={{ headerShown: true, title: "Administración" }}
        />
        <Stack.Screen
          name="admin-blocks"
          options={{ headerShown: true, title: "Administración" }}
        />
        <Stack.Screen
          name="rooms/[id]"
          options={{ headerShown: true, title: "Consultorio" }}
        />
        <Stack.Screen
          name="reservations/index"
          options={{ headerShown: true, title: "Mis reservas" }}
        />
        <Stack.Screen
          name="reservations/[id]"
          options={{ headerShown: true, title: "Reserva" }}
        />
      </Stack.Protected>
      <Stack.Protected guard={!authenticated}>
        <Stack.Screen name="(auth)/login" />
        <Stack.Screen name="(auth)/register" />
      </Stack.Protected>
    </Stack>
  );
}
