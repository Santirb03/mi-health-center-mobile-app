-- AlterEnum
ALTER TYPE "ReservationStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "reservations_status_expiresAt_idx" ON "reservations"("status", "expiresAt");
