BEGIN;
ALTER TABLE "reservations" DROP CONSTRAINT "reservations_doctorId_fkey";
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" DROP CONSTRAINT "payments_reservationId_fkey";
ALTER TABLE "payments" ADD CONSTRAINT "payments_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "refunds" (
 "id" TEXT PRIMARY KEY, "paymentId" TEXT NOT NULL, "amount" INTEGER NOT NULL CHECK ("amount" > 0),
 "status" TEXT NOT NULL, "failureReason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "refunds_paymentId_idx" ON "refunds"("paymentId");
CREATE TABLE "refund_sync" (
 "id" TEXT PRIMARY KEY, "paymentId" TEXT NOT NULL, "automatic" BOOLEAN NOT NULL DEFAULT false,
 "attemptedAt" TIMESTAMP(3), "version" INTEGER NOT NULL DEFAULT 0, "leaseToken" TEXT, "leaseUntil" TIMESTAMP(3),
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastCheckedAt" TIMESTAMP(3),
 "needsReview" BOOLEAN NOT NULL DEFAULT false, "lastError" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "refund_sync_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "refund_sync_paymentId_key" ON "refund_sync"("paymentId");
CREATE INDEX "refund_sync_nextAttemptAt_leaseUntil_idx" ON "refund_sync"("nextAttemptAt", "leaseUntil");

-- Reconcile old refunds without issuing new money movements. Preserve their
-- previous label until Stripe can be consulted; expose them as unverified.
INSERT INTO refund_sync (id, "paymentId", "updatedAt")
SELECT gen_random_uuid()::text, id, CURRENT_TIMESTAMP FROM payments WHERE status IN ('PAID', 'REFUNDED') AND provider = 'stripe';

-- Refund notices now follow the refund itself, not a guessed payment status.
DROP TRIGGER payment_refund_notification ON payments;
DROP FUNCTION notify_payment_refund();
COMMIT;
