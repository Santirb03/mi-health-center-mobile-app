# Reembolsos y recuperación

Cancelar no implica reembolsar. La política de cancelación permanece sin cambios por decisión del usuario (28/09/2026). Desactivar consultorios conserva reservas y pagos existentes.

## Funcionamiento

- Solo los casos automáticos ya existentes (pago tardío o conflicto al confirmar) solicitan devolución. La transacción guarda el pago recibido, el estado de la reserva y un trabajo durable en `refund_sync`; no llama a Stripe.
- Tras commit se intenta procesar el trabajo. El worker del backend reintenta cada 30 segundos (hasta 10 trabajos por ciclo). Una concesión temporal de 120 segundos evita ejecuciones concurrentes. Cada petición Stripe tiene 5 segundos y cero reintentos internos.
- Se consulta la lista completa de Refunds antes de crear una devolución. Se conservan identificadores, montos en centavos, estados y razón de fallo. Un trabajo automático sin devoluciones previas usa una clave por operación persistida.
- Una solicitud ambigua de 20 horas o más no se vuelve a emitir: queda para revisión. Una devolución externa parcial, fallida o cancelada no da autorización para devolver automáticamente el resto.
- `Payment.status=REFUNDED` significa que la suma de devoluciones exitosas cubre el pago completo. Un pago con devolución pendiente/fallida/parcial sigue cobrado (`PAID`), con el detalle de las devoluciones visible por separado. Un evento de devolución recibido antes de la confirmación del cobro no impide procesar esa confirmación.
- Los eventos se concilian consultando Stripe, no copiando estados potencialmente antiguos del payload. Los trabajos pendientes se revisan cada minuto; los demás cada 15 minutos para recuperar eventos perdidos. Un evento recibido durante la consulta obliga a otra revisión inmediata.
- Los fallos de conciliación conservan el trabajo, programan otro intento y muestran revisión pendiente. No se guardan mensajes crudos de error del proveedor. Los avisos internos reflejan el estado de cada Refund, no un cambio arbitrario del pago.
- La conciliación nunca cancela ni reactiva una reserva. No se agregó un endpoint para emitir reembolsos manuales: esa autorización/política sigue pendiente.

## Stripe

Suscribir el endpoint firmado `/payments/webhook` a `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `refund.created`, `refund.updated`, `refund.failed` y `charge.refunded`. Cambiar la suscripción en cada entorno; la migración no configura el Dashboard.

En local el listener de Stripe debe reenviar esos eventos al endpoint. El código no verifica que esa configuración externa esté activa. Las pruebas automatizadas simulan Stripe y usan PostgreSQL desechable.

## Revisión operativa

La agenda y el detalle del doctor muestran importes/estados de devolución y si requieren atención. Ante fallo o ambigüedad, revisar el pago en Stripe antes de cualquier movimiento de dinero. No borrar el trabajo ni generar otra clave para forzar un segundo intento. Resolver el reembolso desde Dashboard bajo autorización del operador; el siguiente evento/sondeo actualizará el estado local. Los casos sin devolución y con intento antiguo requieren una investigación humana, no un reintento automático.

## Migración y conservación

Respaldar antes de aplicar. Se crean `refunds` y `refund_sync`, y se encolan para lectura los pagos Stripe ya marcados PAID/REFUNDED. No se emiten reembolsos por ese backfill. Se retira el trigger que interpretaba REFUNDED como solicitud de devolución. Las notificaciones históricas existentes se conservan.

Las relaciones doctor→reserva, reserva→pago y pago→reembolso/trabajo usan RESTRICT. Borrar un usuario con reservas ya no puede borrar silenciosamente su historial financiero por cascada. Esto no sustituye la política pendiente de retención/anonimización ni impide que un operador con acceso SQL borre explícitamente registros financieros.

Referencia: https://docs.stripe.com/refunds y https://docs.stripe.com/api/idempotent_requests

## Validación local del 28/09/2026

Pasaron 30 pruebas de pagos/concurrencia con Stripe simulado, 50 pruebas de API y respaldo/restauración de 13 tablas en PostgreSQL desechable. Las pruebas incluyen respuesta perdida, fallo de DB tras éxito de Stripe, eventos en orden inverso, devolución parcial externa, recuperación de lease, intento antiguo ambiguo y restricciones de borrado. No constituyen una prueba de una devolución real ni de la configuración del Dashboard.

La migración se aplicó en la base local después de guardar `C:/Users/tudib/Respaldos/mi-health-center/2026-09-28/before-refunds-1790576671822.dump`. Se compararon huellas de las tablas previas: sus 163 registros no cambiaron durante la migración.
