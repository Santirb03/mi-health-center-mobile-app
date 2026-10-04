# Calendario del doctor — Entrega 2B

Validación en dispositivo: NO EJECUTADA.

## Preparación

- Iniciar el backend con la entrega 2A y Metro; comprobar que la URL móvil alcance el servidor.
- Usar cuentas de prueba de doctor y administrador, sin datos reales de pacientes.
- Preparar reservas confirmadas, completadas y pendientes con retención vigente.
- La creación normal permite 20:00–21:00 locales. Los cruces de medianoche requieren un fixture controlado que ya exista; no cambiar las reglas de creación ni editar datos reales para probarlos.

## Lista de comprobación pendiente

- [ ] Como doctor, abrir «Calendario» junto a «Mis reservas»; inicia en Día y selecciona hoy.
- [ ] Como administrador, verificar que no se muestra el acceso. Abrir `/calendar` manualmente: regresa al inicio sin solicitar `/reservations/calendar` ni mostrar «Doctor profile not found».
- [ ] Con una sesión aún en recuperación o `/auth/me` lento, comprobar que espera a conocer el rol. Sin sesión, comprobar la protección de autenticación existente.
- [ ] Navegar a la semana anterior y a la siguiente. El rango y las siete fechas cambian juntos; se selecciona hoy si pertenece a la semana y el lunes si no.
- [ ] Tocar «Hoy» desde otra semana: regresa a la actual y selecciona el día actual.
- [ ] Alternar Día/Semana: cambia la presentación sin otra solicitud de reservas. En Semana hay siete secciones, incluso las vacías.
- [ ] Seleccionar cualquiera de los siete días de la tira o un encabezado semanal: pasa a Día y muestra sus reservas.
- [ ] Distinguir el día seleccionado, hoy y los días con reservas. Revisar cantidades y singular/plural.
- [ ] Revisar consultorio, horarios, estado y precio MXN en Día; tarjetas compactas con horario y estado en Semana.
- [ ] Confirmar que una reserva de las 20:00 locales aparece en el día de negocio correcto, aunque su fecha UTC sea la siguiente.
- [ ] Si hay un fixture de domingo 23:00 a lunes 01:00, revisar ambos días y el lunes de la nueva semana. Conserva los horarios y fechas reales en ambas tarjetas.
- [ ] Si hay un fixture que termina a las 00:00, comprobar que no aparece en el día que inicia allí.
- [ ] Revisar el estado de una reserva pendiente. Si vence mientras se mira la pantalla, su etiqueta refleja la retención vencida; actualizar mediante reenfoque para volver a consultar el backend.
- [ ] Tocar «Ver reserva» y abrir el detalle existente. Volver: conserva semana, modo y selección y refresca la información.
- [ ] Día vacío: «No tienes reservas este día.» y «Ver consultorios» abre `/home`.
- [ ] Semana vacía: cada día muestra «Sin reservas».
- [ ] Cambiar rápidamente entre semanas con conexión lenta: no se mezclan tarjetas, conteos ni errores de semanas anteriores.
- [ ] Perder la conexión durante una lectura; revisar el error y «Reintentar». Recuperar conexión y reintentar sin cambiar el rango.
- [ ] Volver a enfocar o regresar desde segundo plano: se actualiza la semana visible.
- [ ] Con VoiceOver/TalkBack, recorrer controles, modos, tira semanal, cantidades y detalles. Revisar selección, indicador de hoy, textos ampliados y botones en una pantalla pequeña.
- [ ] Navegar por domingo, cambios de mes y cambios de año; comprobar que la semana inicia en lunes y las etiquetas son españolas.
- [ ] Probar `truncated: true`: la advertencia permanece en Día y Semana y «Mis reservas» abre la lista. No se solicitan páginas adicionales ni `/reservations` para completar el calendario.

## Cobertura automática y límites

- `npm test` incluye fechas, semanas, etiquetas, selección, agrupación, deduplicación y finales exclusivos. La agrupación utiliza los días de negocio del inicio y del último milisegundo antes del final, sin crear segmentos ni cambiar las reservas originales.
- Las etiquetas utilizan tablas de días/meses; la conversión de instantes reutiliza `businessDate()` y su zona `America/Mexico_City`, igual que el resto de la app.
- La prueba de independencia del dispositivo cambia `process.env.TZ` entre UTC, Tokio y Honolulu y verifica que la zona local efectivamente cambie. Si el runtime no lo permite, se marca omitida; esto no sustituye la prueba en teléfono.
- Las pruebas de lectura usan hooks/componentes inyectados: verifican el contrato HTTP, el bloqueo de peticiones para administradores y la cancelación antes de leer reservas. No verifican el renderizado nativo, el foco real ni la accesibilidad en dispositivo.
- `truncated` y el límite de 300 están cubiertos con PostgreSQL por las pruebas del backend de 2A. Su presentación en dispositivo sigue pendiente.
- Cambiar de semana monta un recurso nuevo; cambiar modo o día conserva el recurso. El rol se verifica con `/auth/me` antes de cada lectura semanal, reintento o refresco, usando el mismo `AbortSignal`.
- El calendario consulta siete días, no es un selector de disponibilidad ni crea/edita reservas. Una reserva que cruza medianoche puede contarse una vez en cada día con traslape real.
