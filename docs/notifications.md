# Notificaciones

## Comportamiento

- Bandeja privada por usuario: confirmación, cancelación y reembolso solicitado.
- Los triggers de PostgreSQL crean los avisos de confirmación/cancelación dentro de la misma transacción del cambio. Desde la migración del 28/09/2026, los avisos de reembolso los crea el conciliador al leer su estado en Stripe. La clave única evita duplicados y un rollback también elimina el aviso.
- La migración no crea avisos históricos.
- API autenticada: `GET /notifications` (últimos 100 + total no leído), `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`.
- Recordatorios locales opcionales en Android/iOS: una hora antes, exclusivamente reservas confirmadas; sin sonido ni vibración, canal Android de importancia baja. No se envían pushes, correos ni SMS.
- Preferencia por usuario y dispositivo. Se sincronizan al iniciar/volver a la app, al consultar cambios del detalle y cada minuto mientras está activa. Cerrar sesión elimina la programación.
- Se programan las próximas 50 reservas para respetar los límites del sistema. No se envían recordatorios tardíos para reservas hechas con menos de una hora de anticipación.
- No hay sincronización remota con la app cerrada: una cancelación en otro dispositivo puede dejar un recordatorio antiguo hasta abrir esta app. Antes de producción, evaluar un programador central si se requiere actualizar avisos sin abrirla.

## Activación y verificación pendiente

Validación local del 26/09/2026: migración aplicada en `health_center`, 50 pruebas E2E y 21 de pagos aprobadas; respaldo/restauración de prueba aprobado (11 tablas). Los 163 registros previos conservan sus huellas y la bandeja inició vacía. Respaldo previo en `C:/Users/tudib/Respaldos/mi-health-center/2026-09-26/before-notifications.dump`. Backend reiniciado. Sigue pendiente la verificación en teléfono del punto 4. Los pasos 1–3 quedan como procedimiento para otros entornos.

1. Con Docker ya disponible, ejecutar las pruebas `npm run test:e2e`, `npm run test:payments:integration` y `npm run test:backup` en backend.
2. Crear y verificar un respaldo de la base actual antes de `npm run migrate:deploy`. Nunca usar reset ni db push para esta actualización.
3. Reiniciar backend después de generar Prisma y aplicar la migración.
4. Reconstruir la app nativa con el plugin expo-notifications. Verificar en teléfono real: permiso rechazado, activar/desactivar, recibir con app cerrada sin sonido/vibración, no duplicar al reabrir, cancelar reserva, cambiar cuenta y cerrar sesión. Los ajustes del sistema pueden cambiar la presentación.

Documentación: https://docs.expo.dev/versions/v57.0.0/sdk/notifications/

## Prueba rápida en Expo Go

Los recordatorios actuales son locales y se pueden probar en Expo Go. En desarrollo, entra como doctor a Notificaciones, activa los recordatorios y pulsa «Probar aviso silencioso (15 segundos)». Ve al inicio del teléfono sin cerrar sesión y revisa su centro de notificaciones. Comprueba ausencia de sonido y vibración. Este botón no crea reservas ni pagos y no aparece en producción. La recepción real requiere comprobación del usuario en el teléfono.
