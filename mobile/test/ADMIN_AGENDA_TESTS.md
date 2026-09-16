# Agenda del administrador

## Alcance

Consulta de reservas por día de Ciudad de México (UTC-06, igual que disponibilidad), consultorio y estado. Incluye nombre del médico, horarios, importe y estado de pago; no expone pacientes, credenciales ni identificadores de Stripe. Es una vista de consulta, sin modificación de reservas o pagos. No requiere migración ni dependencias nuevas.

El inicio consulta `GET /auth/me` y muestra **Agenda del administrador** para cuentas ADMIN. Un doctor conserva **Mis reservas**. El acceso directo a la pantalla también verifica el perfil. El backend valida JWT y consulta el rol actual en la base de datos para cada solicitud administrativa.

## API

- `GET /auth/me`: id y rol actual del usuario autenticado.
- `GET /admin/rooms`: consultorios activos e inactivos para filtros (ADMIN).
- `GET /admin/agenda?date=2031-01-10&status=CONFIRMED&page=1`: `date` obligatorio, `roomId` UUID y `status` opcionales. Página de 50 elementos, orden por inicio e id, indicador `hasMore`. Se incluyen reservas que intersectan el día solicitado.

La agenda calcula `displayStatus=EXPIRED` para retenciones vencidas, sin escribir en la reserva. El filtro PENDING incluye solo retenciones vigentes y EXPIRED también incluye retenciones vencidas aún persistidas como PENDING. El campo `status` conserva el estado original. Un webhook tardío sigue usando las reglas existentes. Actualiza la agenda para volver a aplicar los filtros conforme pase el tiempo.

## Prueba en iPhone

1. Reinicia el backend con los cambios y recarga Expo. Inicia sesión con una cuenta que ya tenga rol ADMIN; no se crean cuentas ni se cambian roles automáticamente.
2. Abre **Agenda del administrador** desde inicio. Consulta la fecha de una reserva conocida y verifica médico, consultorio, horario, importe y pago.
3. Combina filtros de consultorio y estado. Cambia fecha con el campo AAAA-MM-DD, Hoy, Día anterior y Día siguiente. Un cambio de filtro vuelve a la página 1.
4. Consulta una combinación sin reservas: debe mostrar estado vacío. Introduce una fecha imposible (2031-02-29): debe mostrar validación sin cambiar la consulta.
5. Si hay más de 50 reservas, usa Página siguiente/anterior. Actualizar vuelve a consultar la página actual.
6. Interrumpe la red y actualiza: debe mostrar error y permitir reintentar. Vuelve a iniciar sesión como DOCTOR: debe conservar Mis reservas y no mostrar la agenda administrativa.

## Validación automatizada

Backend: `node node_modules/jest/bin/jest.js --runInBand`.
Mobile: `npm test` y `npm run typecheck`.

`backend/src/reservations/admin-agenda.spec.ts` usa HTTP, JWT reales de prueba y Prisma simulado. Comprueba 401/403, revocación de rol, rechazo de refresh tokens, validación de filtros, límites del día, paginación y proyección de vencimiento. No se conecta a la base de datos de desarrollo ni a Stripe. La interacción en iPhone se verifica manualmente.
