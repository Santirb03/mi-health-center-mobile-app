# Dashboard administrativo — QA 4B

**NO VALIDADO EN DISPOSITIVO.** Todas las comprobaciones manuales siguientes están pendientes. Los tests de hooks/componentes usan módulos reales con dependencias inyectadas; no renderizan React Native ni validan VoiceOver o TalkBack.

## Verificación automatizada

- `npm test`: 206 pruebas aprobadas, 65 nuevas de dashboard, cero fallos.
- Expo export: Android, iOS y web aprobados, 20 rutas estáticas incluida /admin-dashboard. Se regeneraron los tipos locales de rutas mediante el CLI de Expo ya instalado; .expo/ queda ignorado.
- `npm run typecheck`: código 0.
- `git diff --check`: código 0.
- Mutación temporal: incluir minutos de un consultorio inactivo produjo 180 minutos y 9000 bp en lugar de 100 minutos y 5000 bp. La prueba falló con código 1. Tras restaurar los bytes originales, `git diff --no-index` dio código 0 y la misma prueba pasó.
- No fue necesario modificar pruebas existentes. Los dos archivos locales protegidos conservaron sus hashes SHA256.

## Checklist manual pendiente

- [ ] Abrir «Resumen» desde la tarjeta de AdminHome.
- [ ] Abrir «Resumen» desde la pestaña de AdminNav.
- [ ] Con cuenta ADMIN, comprobar que carga GET /admin/dashboard.
- [ ] Con cuenta DOCTOR, comprobar el mensaje de acceso y «Volver al inicio»; no consultar el dashboard.
- [ ] Seleccionar Día y revisar sus límites inclusivos.
- [ ] Seleccionar Semana: lunes a domingo.
- [ ] Seleccionar Mes: mes calendario completo, incluyendo febrero.
- [ ] Probar ambas flechas, incluyendo periodos futuros.
- [ ] Probar navegación diciembre/enero y desde un día 31.
- [ ] Seleccionar Personalizado y comprobar los 30 días inclusivos iniciales y controles Desde/Hasta.
- [ ] Elegir Hasta anterior a Desde: error anunciado y ninguna petición del dashboard.
- [ ] Elegir 63 días: error «El periodo máximo es de 62 días.» y ninguna petición.
- [ ] Elegir exactamente 62 días: consultar normalmente.
- [ ] Comparar un caso conocido con el backend: confirmadas incluye completed, cancelación usa confirmed + completed + cancelled, neto conserva los valores del servidor.
- [ ] Comprobar consultorio inactivo: actividad visible, ocupación «—», fuera del cálculo general.
- [ ] Comprobar consultorio sin disponibilidad: ocupación desconocida y fuera del cálculo general.
- [ ] Comprobar ocupación superior a 100 %: texto real y barra limitada visualmente a 100 %.
- [ ] Comprobar periodo sin datos: ceros, porcentajes no calculables «—» y lista vacía sin error.
- [ ] Probar desconexión y Reintentar.
- [ ] Probar Actualizar y hora de actualización en Ciudad de México.
- [ ] Cambiar rápidamente entre periodos: nunca mostrar métricas de otra clave de fechas.
- [ ] Comprobar cuatro pestañas en un teléfono angosto, sin refactorizar AdminNav.
- [ ] Verificar que «Consultorios» no queda cortado.
- [ ] Verificar que «Resumen» no queda cortado.
- [ ] Probar VoiceOver y TalkBack: encabezados, orden de lectura, estados y errores.
- [ ] Verificar nombres y selección de controles; Actualizar deshabilitado durante carga/rango inválido.
- [ ] Comprobar que las barras decorativas no se leen ni duplican el porcentaje.

## Decisiones y límites

- El backend decide reservas, cobros y reembolsos. El móvil solo calcula la tasa operativa de cancelación, la ocupación ponderada y el orden de consultorios.
- Los reembolsos exitosos reducen el neto del periodo del pago original; los pendientes no lo reducen. El neto histórico puede cambiar posteriormente.
- No existe historial de activación. La capacidad histórica de consultorios actualmente inactivos es desconocida.
- Los helpers de fechas reutilizan booking/calendar, que son módulos puros. Los nuevos nombres de meses y cálculos mensuales no usan Intl ni la zona local del dispositivo.
- periodRange('custom') rechaza el cálculo automático; usa exclusivamente las fechas explícitas de los controles. Las flechas no aparecen en Personalizado.
- El parser del comprobante admite solo importes no negativos en centavos seguros de number. Para ordenar netos negativos y agregados grandes, el dashboard usa un parser firmado bigint sin conversión monetaria flotante.
- El formato visual reutiliza money() con los strings originales, sin recalcular los totales.
- Solo las barras visuales se limitan a 0–100 %; el porcentaje textual y los datos originales se conservan.
- El ranking usa desempate determinista por nombre y roomId, sin mutar la respuesta.
- La distribución actual de cuatro pestañas y los controles de fechas/navegación requieren revisión visual en dispositivo.
- No se añadieron gráficas, dependencias, endpoints, funciones de pacientes ni 4C.
