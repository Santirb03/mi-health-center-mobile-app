CREATE TABLE "notifications" (
 "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "reservationId" TEXT NOT NULL,
 "eventKey" TEXT NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "readAt" TIMESTAMP(3),
 CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "notifications_eventKey_key" ON "notifications"("eventKey");
CREATE INDEX "notifications_userId_createdAt_id_idx" ON "notifications"("userId", "createdAt", "id");
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- The inbox event commits or rolls back with the reservation, regardless of
-- which service updates it. Replayed webhooks cannot create duplicate notices.
CREATE FUNCTION notify_reservation_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'UPDATE' THEN
   IF OLD.status = NEW.status THEN RETURN NEW; END IF;
 END IF;
 IF NEW.status IN ('CONFIRMED', 'CANCELLED') THEN
   INSERT INTO notifications (id, "userId", "reservationId", "eventKey", title, body)
   SELECT gen_random_uuid()::text, d."userId", NEW.id, NEW.id || ':' || NEW.status::text,
     CASE WHEN NEW.status = 'CONFIRMED' THEN 'Reserva confirmada' ELSE 'Reserva cancelada' END,
     CASE WHEN NEW.status = 'CONFIRMED' THEN 'Tu reserva está confirmada. Consulta sus detalles en Mis reservas.' ELSE 'Tu reserva fue cancelada. Consulta sus detalles en Mis reservas.' END
   FROM doctor_profiles d WHERE d.id = NEW."doctorId"
   ON CONFLICT ("eventKey") DO NOTHING;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER reservation_notification AFTER INSERT OR UPDATE OF status ON reservations
FOR EACH ROW EXECUTE FUNCTION notify_reservation_status();

CREATE FUNCTION notify_payment_refund() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status = 'REFUNDED' AND OLD.status IS DISTINCT FROM NEW.status THEN
   INSERT INTO notifications (id, "userId", "reservationId", "eventKey", title, body)
   SELECT gen_random_uuid()::text, d."userId", r.id, NEW.id || ':REFUNDED',
     'Reembolso solicitado', 'Se solicitó el reembolso de tu pago. El tiempo para verlo reflejado depende de tu banco.'
   FROM reservations r JOIN doctor_profiles d ON d.id = r."doctorId"
   WHERE r.id = NEW."reservationId"
   ON CONFLICT ("eventKey") DO NOTHING;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER payment_refund_notification AFTER UPDATE OF status ON payments
FOR EACH ROW EXECUTE FUNCTION notify_payment_refund();
