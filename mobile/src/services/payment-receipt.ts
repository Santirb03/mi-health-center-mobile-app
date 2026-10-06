import type { BusinessReceiptConfig } from "../config/business";
import type { PaymentHistoryItem } from "./payment-history";
import { dayLongLabel, reservationDay } from "./calendar";
import { formatTime, money } from "./booking";
import { paymentDateLabel, paymentStatusText } from "./payment-history";

export function amountToCents(text: string): number {
  const parts = typeof text === "string" ? /^(\d+)(?:\.(\d{1,2}))?$/.exec(text) : null;
  if (!parts) throw new Error("Invalid amount");
  // Read the whole and fractional digits as a single integer, without peso floats.
  const digits = parts[1] + (parts[2] ?? "").padEnd(2, "0");
  let cents = 0;
  for (const digit of digits) {
    cents = cents * 10 + (digit.charCodeAt(0) - 48);
    if (!Number.isSafeInteger(cents)) throw new Error("Amount exceeds safe integer cents");
  }
  return cents;
}

export function centsToText(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("Invalid integer cents");
  const integer = BigInt(cents);
  const absolute = integer < 0n ? -integer : integer;
  return `${integer < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function succeededRefundCents(refunds: PaymentHistoryItem["refunds"]): number {
  let cents = 0;
  for (const refund of refunds) {
    if (refund.status !== "succeeded") continue;
    if (!Number.isSafeInteger(refund.amount) || refund.amount < 0) throw new Error("Invalid refund cents");
    cents += refund.amount;
    if (!Number.isSafeInteger(cents)) throw new Error("Refunds exceed safe integer cents");
  }
  return cents;
}

export function buildPaymentReceipt(item: PaymentHistoryItem, business: BusinessReceiptConfig) {
  const paid = amountToCents(item.amount);
  const refunded = succeededRefundCents(item.refunds);
  const details = [business.address, business.phone, business.email].map(value => value.trim()).filter(Boolean);
  const title = "Comprobante de pago";
  const lines = [
    { label: "Referencia", value: item.id.slice(0, 8).toUpperCase() },
    { label: "Consultorio", value: item.reservation.room.name },
    { label: "Reserva", value: `${dayLongLabel(reservationDay(item.reservation.startTime))} · ${formatTime(item.reservation.startTime)}–${formatTime(item.reservation.endTime)}` },
    { label: "Fecha de pago", value: paymentDateLabel(item.paidAt) },
    { label: "Monto pagado", value: `${money(centsToText(paid))} MXN` },
    { label: "Estado del pago", value: paymentStatusText(item.status) },
  ];
  if (item.refunds.some(refund => refund.status === "succeeded")) {
    lines.push(
      { label: "Reembolsado", value: `${money(centsToText(refunded))} MXN` },
      { label: "Neto", value: `${money(centsToText(paid - refunded))} MXN` },
    );
  }
  const processing = item.refunds.filter(refund => refund.status === "pending" || refund.status === "requires_action").length;
  if (processing) lines.push({ label: "Devoluciones en proceso", value: String(processing) });
  return {
    title, business: { name: business.name, details }, lines, legend: business.legend,
    text: [business.name, ...details, "", title, ...lines.map(line => `${line.label}: ${line.value}`),
      "", "Montos en pesos mexicanos (MXN).", business.legend].join("\n"),
  };
}
