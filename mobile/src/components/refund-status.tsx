import { Text, View } from 'react-native';
import { money } from '../services/booking';

export interface PaymentSummary {
  status: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  refunds?: { amount: number; status: string }[];
  refundSync?: { automatic: boolean; lastCheckedAt: string | null; needsReview: boolean; lastError: string | null } | null;
}

export function RefundStatus({ payment }: { payment?: PaymentSummary | null }) {
  if (!payment) return null;
  const labels: Record<string, string> = { pending: 'Pendiente', requires_action: 'Requiere atención', succeeded: 'Procesado por Stripe', failed: 'Fallido', canceled: 'Cancelado' };
  return <View style={{ gap: 6 }}>
    {payment.refundSync && !payment.refundSync.lastCheckedAt && <Text>Reembolsos pendientes de verificar.</Text>}
    {payment.refunds?.map((refund, index) => <Text key={index}>Reembolso: {money(refund.amount / 100)} · {labels[refund.status] ?? 'Por verificar'}</Text>)}
    {payment.refundSync?.needsReview && <Text>El reembolso necesita revisión de administración.</Text>}
    {payment.refundSync?.lastError === 'reconciliation_failed' && <Text>El estado puede estar desactualizado. Se volverá a consultar.</Text>}
    {payment.refundSync?.automatic && !payment.refunds?.length && <Text>Devolución solicitada; todavía no se confirma su resultado.</Text>}
  </View>;
}
