import { Text } from "react-native";
import type { Reservation } from "../services/reservations";

export interface ReservationPaymentProps {
  id: string;
  reservation: Reservation | null;
  refresh(): Promise<void>;
}
export function ReservationPayment(_props: ReservationPaymentProps) {
  return <Text>Abre la app en iPhone o Android para pagar.</Text>;
}
