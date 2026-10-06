import { useState } from "react";
import { Modal, ScrollView, Share, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BUSINESS_RECEIPT } from "../config/business";
import type { PaymentHistoryItem } from "../services/payment-history";
import { buildPaymentReceipt } from "../services/payment-receipt";
import { Action, styles } from "./booking-ui";

export function PaymentReceiptModal({ item, onClose }: { item: PaymentHistoryItem; onClose(): void }) {
  const receipt = buildPaymentReceipt(item, BUSINESS_RECEIPT);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  async function share() {
    if (sharing) return;
    setSharing(true);
    setError(null);
    try {
      await Share.share({ message: receipt.text });
    } catch {
      setError("No pudimos abrir el menú para compartir.");
    } finally {
      setSharing(false);
    }
  }
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} accessibilityViewIsModal>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#f7f8fa" }}>
        <ScrollView contentContainerStyle={styles.page} accessibilityViewIsModal onAccessibilityEscape={onClose}>
          <Text style={styles.subtitle}>{receipt.business.name}</Text>
          {receipt.business.details.map((detail, index) => <Text key={index}>{detail}</Text>)}
          <Text accessibilityRole="header" style={styles.title}>{receipt.title}</Text>
          <View style={styles.card}>
            {receipt.lines.map(line => (
              <View key={line.label} style={{ gap: 4 }}>
                <Text style={styles.muted}>{line.label}</Text>
                <Text>{line.value}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.muted}>Montos en pesos mexicanos (MXN).</Text>
          <Text style={styles.muted}>{receipt.legend}</Text>
          {error && <Text accessibilityRole="alert">{error}</Text>}
          <View accessibilityState={{ busy: sharing }}>
            <Action title={sharing ? "Abriendo compartir…" : "Compartir"} disabled={sharing} onPress={() => void share()} />
          </View>
          <Action title="Cerrar" variant="secondary" onPress={onClose} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
