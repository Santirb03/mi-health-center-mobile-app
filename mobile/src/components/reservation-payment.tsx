import { Text } from "react-native";
import type { Reservation } from "../services/reservations";
import { canPay } from "../services/checkout";
import { useNow } from "../hooks/use-now";

export interface ReservationPaymentProps {
  id: string;
  reservation: Reservation | null;
  refresh(): Promise<void>;
}
export function ReservationPayment({ reservation }: ReservationPaymentProps) {
  const now = useNow();
  if (!reservation || !canPay(reservation, now)) return null;
  return <Text>Abre la app en iPhone o Android para pagar.</Text>;
}
