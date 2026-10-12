BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- No historical rows are rewritten or deleted. Incompatible rows abort migration.
ALTER TABLE "appointments" ADD COLUMN "reservationId" TEXT;
CREATE UNIQUE INDEX "patients_id_doctorId_key" ON "patients"("id", "doctorId");
CREATE UNIQUE INDEX "reservations_id_doctorId_key" ON "reservations"("id", "doctorId");
CREATE INDEX "appointments_doctorId_startTime_idx" ON "appointments"("doctorId", "startTime");

ALTER TABLE "appointments" DROP CONSTRAINT "appointments_patientId_fkey";
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patientId_doctorId_fkey"
  FOREIGN KEY ("patientId", "doctorId") REFERENCES "patients"("id", "doctorId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_reservationId_doctorId_fkey"
  FOREIGN KEY ("reservationId", "doctorId") REFERENCES "reservations"("id", "doctorId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_end_after_start"
  CHECK ("endTime" > "startTime");
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_no_overlap"
  EXCLUDE USING gist (
    "doctorId" WITH =,
    tsrange("startTime", "endTime", '[)') WITH &&
  ) WHERE ("status" <> 'CANCELLED');

COMMIT;
