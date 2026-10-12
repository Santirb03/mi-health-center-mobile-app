# Citas con pacientes — QA de 5E

**NO VALIDADO EN DISPOSITIVO.** Todos los casos siguientes siguen pendientes.

Preparación: backend 5D con sus migraciones aplicadas, sesión de doctor con
pacientes propios y reservas confirmadas. Usar datos sintéticos. El backend
decide los estados y conflictos; esta entrega no aplica migraciones a la DB.

- [ ] Agenda vacía: al terminar una lectura exitosa aparece «No tienes citas para este día.»; no aparece durante carga ni errores.
- [ ] Agenda con citas: nombre, horario de Ciudad de México, estado, consultorio y enlace al detalle; solo programadas y completadas.
- [ ] Cambiar día rápidamente, anterior/siguiente/Hoy/calendario y Actualizar; no quedan tarjetas del día anterior ni respuestas tardías.
- [ ] Seleccionar paciente: búsqueda de 5C, paginación, limpiar búsqueda, nombre seleccionado aunque cambie la búsqueda; no cargar el histórico completo.
- [ ] Seleccionar reserva: solo propia CONFIRMED que contenga todo el intervalo; PENDING/CANCELLED/EXPIRED no son opciones. Actualizar reservas.
- [ ] Nueva cita de 15 minutos y otra de 240; rechazo por duración, fecha inválida/pasada, fin anterior e inicio/fin no múltiplos de cinco.
- [ ] Dos citas consecutivas dentro de la misma reserva se aceptan.
- [ ] Conflicto: crear citas superpuestas (también desde dos dispositivos) y verificar mensaje seguro de 409 sin perder borrador.
- [ ] Reprogramar: paciente permanece fijo, reserva y horario precargados; cambiar horario y volver a seleccionar reserva; no disponible después del inicio.
- [ ] Cancelar: confirmar el aviso de que no cancela la reserva ni genera reembolso; estado actualizado en detalle e historial, desaparece de la agenda diaria.
- [ ] Completar: acción ausente antes del inicio; disponible desde el inicio; estado actualizado después de responder el backend.
- [ ] Reserva cancelada posteriormente: cita sigue mostrando el estado recibido y aviso de revisión; no inventar consultorio para una cita histórica sin reserva.
- [ ] Historial: canceladas visibles; cargar varias páginas sin duplicados; filtrar por paciente vuelve al primer cursor; borrar filtro vuelve al historial general.
- [ ] Error de red en página posterior conserva citas y cursor; Reintentar pide la misma página. Error de agenda no se presenta como vacío.
- [ ] Cambio de sesión durante lecturas/escrituras y durante confirmación de cancelación; no aparecen pacientes/citas de la sesión anterior ni se navega con su respuesta.
- [ ] Zona horaria: con dispositivo en Los Ángeles y Tokio se conservan fecha, horas y reserva de Ciudad de México, incluyendo bordes del día.
- [ ] Teclado numérico/puntuación en iPhone y Android permite escribir guiones y dos puntos; teclado no oculta el botón ni pierde el borrador.
- [ ] Navegación: Citas solo en menú de doctor; Nueva cita/Detalle/Reprogramar/Volver; logout retira rutas protegidas; abrir solo IDs en enlaces.
- [ ] VoiceOver/TalkBack: encabezados, etiquetas, estados textuales, avisos, carga, botones deshabilitados y confirmación de cancelación.
- [ ] Truncamiento: el calendario de citas avisa y dirige conceptualmente al historial. En selección de reservas, un calendario truncado usa páginas confirmadas hasta terminar el día; fallo intermedio no ofrece una lista parcial.
- [ ] Dos pulsaciones inmediatas en Guardar/cancelar/completar originan una sola escritura. Tras timeout de creación revisar agenda antes de repetir: el servidor pudo guardar la cita.

## Verificación automatizada

`npm test` incluye `appointment-form.test.cjs` y `appointment-schedule.test.cjs`:
horarios UTC−6 bajo zonas distintas reales, payloads, DTO/errores seguros,
componentes de formulario/detalle, paginación reutilizada, aislamiento de sesión
y respaldo paginado de reservas sin límite de 50 candidatos.

No se guardan pacientes/citas en almacenamiento persistente. Las comprobaciones
de interfaz usan el mismo transpilado TypeScript y harness de componentes de 5C;
no sustituyen prueba real de teclado, permisos de acceso ni lectores de pantalla.

Resultados ejecutados al implementar 5E sobre `main`, HEAD `121a129`:

- `npm test`: 339 pruebas, 339 aprobadas, 0 fallos, 0 omitidas (57 nuevas de citas).
- Expo export: iOS, Android y web; 26 rutas estáticas. El primer intento falló
  por permisos del sandbox al escribir `index.hbc`; repetir fuera del sandbox
  completó la exportación. Artefactos solo en `.expo/ci-export` (ignorado).
- Las tres mutaciones solicitadas fueron detectadas: conversión en zona local,
  cursor conservado al cambiar paciente y eliminación del bloqueo de doble
  creación. Cada ejecución falló con código 1; después se restauraron los bytes
  y SHA256 originales y se ejecutó de nuevo toda la suite con éxito.

Hashes de restauración de las mutaciones:

| Archivo | SHA256 después de restaurar |
| --- | --- |
| `src/services/appointment-form.ts` | `6347366CF84F778D9F3C3249B7BF3C5858614F17C6FDD955C0E74303459E61FC` |
| `src/services/patient-pager.ts` | `DE425EF5FBDED2F7A3FCBDAC67A2D7F54B3B58D4DD8CFB526A0292337D90B90B` |
| `src/app/appointments/form.tsx` | `EEB3B4E960EDD4461988C344DDA9AB55AED681A8E1983C1455CDFD7241F077B9` |

## Decisiones y límites

- Reutilizar `createPatientPager` mediante tipos genéricos y mensaje opcional,
  conservando su comportamiento por defecto y todas las pruebas previas.
- El historial filtra por ID de paciente; cambiarlo borra items/cursor y aborta la
  lectura anterior. Nombres nunca se pasan en parámetros de navegación.
- Las reservas del día se obtienen con el calendario existente. Si está truncado,
  se recorren `/reservations/page?group=confirmed` (orden ascendente por inicio)
  hasta fin de páginas o hasta alcanzar el siguiente día. La consulta puede ser
  más lenta con muchos registros; se aborta al salir/cambiar de día/sesión.
- Las consultas paginadas no son una instantánea transaccional: una reserva puede
  cambiar mientras se selecciona; el backend vuelve a validar al guardar.
- No se envían `notes`, `doctorId`, `roomId` ni cambios arbitrarios de estado.
- No hay reintento automático de creación después de fallos ambiguos de red.
  El usuario debe revisar la agenda antes de repetir una creación incierta.
- Fechas/horas del formulario se convierten con el offset −06:00 usado por 5D.
  La entrega no implementa citas de varios días ni un calendario nuevo de reservas.
- No se implementa 5F, edición clínica ni creación de pacientes en el formulario.
