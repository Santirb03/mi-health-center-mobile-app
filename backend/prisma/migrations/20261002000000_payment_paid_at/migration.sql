ALTER TABLE "payments" ADD COLUMN "paidAt" TIMESTAMP(3);

-- Aproximación para filas anteriores a esta columna (datos de prueba):
UPDATE "payments"
SET "paidAt" = "updatedAt"
WHERE "status" IN ('PAID', 'REFUNDED')
  AND "paidAt" IS NULL;
