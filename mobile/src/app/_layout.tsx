import { Stack } from "expo-router";
import { ActivityIndicator, Alert, Button, Text, View } from "react-native";
import { SessionProvider, useSession } from "../providers/session-provider";

export default function RootLayout() {
  return (
    <SessionProvider>
      <SessionNavigator />
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
      </Stack.Protected>
      <Stack.Protected guard={!authenticated}>
        <Stack.Screen name="(auth)/login" />
      </Stack.Protected>
    </Stack>
  );
}
