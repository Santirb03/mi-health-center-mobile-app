import { router } from "expo-router";
import { Text, View } from "react-native";
import { useResource } from "../hooks/use-resource";
import { getCurrentUser } from "../services/admin-agenda";
import { Action, LoadState } from "./booking-ui";

export function ReservationNavigation() {
  const user = useResource(getCurrentUser);
  return (
    <View style={{ paddingHorizontal: 24, paddingBottom: 16, gap: 8 }}>
      <LoadState {...user} />
      {user.data?.role === "ADMIN" && (
        <Action
          title="Agenda del administrador"
          onPress={() => router.push("/admin-agenda")}
        />
      )}
      {user.data?.role === "DOCTOR" && (
        <Action
          title="Mis reservas"
          onPress={() => router.push("/reservations")}
        />
      )}
      {user.error && (
        <Text>
          No pudimos verificar tu perfil para mostrar las opciones de reservas.
        </Text>
      )}
    </View>
  );
}
