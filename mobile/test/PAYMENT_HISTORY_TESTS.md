# Mis pagos — Entrega 3B

NO VALIDADO EN DISPOSITIVO

Validación en dispositivo: NO EJECUTADA.

## Preparación

- Usar backend con entrega 3A y la migración `paidAt` aplicada en un entorno de desarrollo. Iniciar Metro y comprobar la conexión desde el teléfono.
- Usar cuentas ficticias de doctor y administrador, sin datos reales ni cobros reales. Los datos siguientes son fixtures de prueba; esta pantalla solo consulta.
- Preparar pagos PAID de 150.10 y REFUNDED de 99.90 pesos, un refund succeeded de 3000 centavos y otros pending/failed de 3000 centavos. El resumen esperado es Pagado 250.00, Reembolsado 30.00 y Neto 220.00 pesos. PENDING/FAILED no deben aparecer como pagos.
- Preparar un pago con `paidAt: null`, reservas CANCELLED/EXPIRED con pago y más de 20 pagos para el mismo doctor.
- Para simular un fallo solo de la segunda página, usar un entorno de prueba que falle una lectura con cursor. Perder conexión puede ocasionar una recarga completa al volver a primer plano; probar el fallo de paginación sin abandonar la pantalla.

## Comprobaciones pendientes

- [ ] Como doctor, abrir «Mis pagos» junto a «Mis reservas» y «Calendario».
- [ ] Confirmar título, moneda MXN y aviso de horarios de Ciudad de México.
- [ ] Comprobar el resumen 250.00 / 30.00 / 220.00 contra los fixtures; son totales de toda la historia, no solo los 20 visibles.
- [ ] Pago sin reembolso: verificar consultorio, fecha y horario de reserva, monto, «Pagado» y fecha del pago.
- [ ] Refund succeeded: ver «Procesado por Stripe» mediante RefundStatus y comprobar que reduce Neto.
- [ ] Refund pending: ver «Pendiente»; no reduce Neto ni aumenta Reembolsado.
- [ ] Pago antiguo con `paidAt: null`: mostrar «Pago: Fecha de pago no registrada», sin usar createdAt como sustituto.
- [ ] Reserva CANCELLED con pago: «La reserva fue cancelada.»; la nota no afirma que se haya devuelto dinero.
- [ ] Reserva EXPIRED con pago: «La reserva venció.»; las devoluciones se explican solo mediante RefundStatus.
- [ ] Pago de `2026-10-06T02:00:00Z`: la fecha mostrada es «lunes 5 de octubre», correspondiente a Ciudad de México.
- [ ] Más de 20 pagos: pulsar «Cargar más»; comprobar continuidad, orden y ausencia de duplicados, conservando el resumen financiero.
- [ ] Pulsar varias veces «Cargar más» con red lenta: una sola petición activa, control deshabilitado e indicador de carga.
- [ ] Error de primera página: sin tarjetas anteriores, mensaje genérico y reintento que vuelve a leer la primera página.
- [ ] Error de página posterior: lista y totales permanecen visibles; mensaje en línea y «Reintentar».
- [ ] Recuperar conexión sin salir de la pantalla y reintentar: solicita el cursor que falló y añade datos sin perder lo cargado.
- [ ] Pulsar «Actualizar»: limpia lista y resumen durante la recarga; vuelve a la primera página y obtiene nuevos totales.
- [ ] Actualizar mientras otra petición tarda: su respuesta anterior no reemplaza los datos nuevos.
- [ ] «Ver reserva» abre el detalle de esa reserva. Al volver, la pantalla recarga la primera página.
- [ ] Volver desde segundo plano: recarga completa; al salir de la pantalla cancela la petición activa.
- [ ] Sin pagos: mostrar «Aún no tienes pagos registrados.» y resumen de ceros recibido del backend.
- [ ] Como administrador, no aparece «Mis pagos» en la navegación normal y sus opciones administrativas permanecen iguales. La ruta manual está autenticada; un usuario sin DoctorProfile recibe el error genérico, sin una llamada adicional a `/auth/me` desde esta pantalla.
- [ ] Sin sesión, comprobar la protección de la ruta existente.
- [ ] Con VoiceOver/TalkBack, recorrer encabezados, resumen, errores y acciones; verificar botones deshabilitados, carga, lectura de fechas y navegación al detalle.
- [ ] Revisar texto ampliado y pantalla pequeña: montos, notas y reembolsos legibles.

## Cobertura automática y límites

- `npm test` incluye el pager puro, cancelación y respuestas tardías, exclusión de peticiones simultáneas, reintentos, deduplicación, orden, conservación de totales y helpers.
- Las pruebas de API verifican URL, cursor y AbortSignal sin peticiones externas. Los fixtures de pantalla y hook usan módulos reales con dependencias inyectadas: no constituyen renderizado nativo ni validación del foco real o del lector de pantalla.
- Fechas reutilizan `reservationDay`, `dayLongLabel` y `formatTime`; importaciones de tipos desde componentes no introducen React en el pager.
- `amount` y totals llegan en pesos y se muestran con `money()` existente. Los refunds individuales se entregan completos a RefundStatus, que mantiene sus centavos y presentación actual.
- Los totales se capturan solo de la primera página y no se recalculan desde la lista. Pueden cambiar al actualizar; no son una vista contable con fees, impuestos ni utilidad.
- `paidAt` histórico puede ser aproximado por el backfill de 3A. Un null se muestra explícitamente sin inventar una fecha.
- La entrega no incluye comprobantes, PDFs, compartir, descargas, CFDI, facturación, vista administrativa ni acción manual de refund.
