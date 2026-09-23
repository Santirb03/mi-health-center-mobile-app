# Agenda del administrador

## Alcance

Consulta de reservas por día de Ciudad de México (UTC-06, igual que disponibilidad), consultorio y estado. Incluye nombre del médico, horarios, importe y estado de pago; no expone pacientes, credenciales ni identificadores de Stripe. Es una vista de consulta, sin modificación de reservas o pagos. No requiere migración ni dependencias nuevas.

El inicio consulta `GET /auth/me` y muestra un panel exclusivo de **Administración** para cuentas ADMIN, con accesos a Agenda, Consultorios y Bloqueos. Un doctor conserva **Mis reservas**. El acceso directo a la pantalla también verifica el perfil. El backend valida JWT y consulta el rol actual en la base de datos para cada solicitud administrativa.

## API

- `GET /auth/me`: id y rol actual del usuario autenticado.
- `GET /admin/rooms`: consultorios activos e inactivos para filtros (ADMIN).
- `GET /admin/agenda?date=2031-01-10&status=CONFIRMED&page=1`: `date` obligatorio, `roomId` UUID y `status` opcionales. Página de 50 elementos, orden por inicio e id, indicador `hasMore`. Se incluyen reservas que intersectan el día solicitado.

La agenda calcula `displayStatus=EXPIRED` para retenciones vencidas, sin escribir en la reserva. El filtro PENDING incluye solo retenciones vigentes y EXPIRED también incluye retenciones vencidas aún persistidas como PENDING. El campo `status` conserva el estado original. Un webhook tardío sigue usando las reglas existentes. Actualiza la agenda para volver a aplicar los filtros conforme pase el tiempo.

## Prueba en iPhone

1. Reinicia el backend con los cambios y recarga Expo. Inicia sesión con una cuenta que ya tenga rol ADMIN; no se crean cuentas ni se cambian roles automáticamente.
2. Abre **Agenda** desde Administración. Consulta la fecha de una reserva conocida y verifica médico, consultorio, horario, importe y pago.
3. La agenda abre con filtros cerrados y sin formulario de bloqueos. Abre Filtros y combina consultorio y estado. Toca la fecha para abrir el calendario, cambia de mes, elige día y usa Ir a hoy. Las flechas de la agenda cambian un día. Un cambio de fecha o filtro vuelve a la página 1.
4. Consulta una combinación sin reservas: debe mostrar estado vacío. El calendario solo muestra fechas reales; comprueba febrero, un año bisiesto y el cruce diciembre/enero. Cerrar calendario conserva la fecha consultada.
5. Si hay más de 50 reservas, usa Página siguiente/anterior. Actualizar vuelve a consultar la página actual.
6. Interrumpe la red y actualiza: debe mostrar error y permitir reintentar. Vuelve a iniciar sesión como DOCTOR: debe conservar Mis reservas y no mostrar la agenda administrativa.
7. Cambia rápidamente consultorio, estado y página: las tarjetas anteriores no
   deben aparecer bajo los filtros nuevos. La navegación siguiente solo se habilita
   con la respuesta de la consulta actual.
8. Usa Limpiar filtros: conserva la fecha consultada, quita consultorio/estado y
   vuelve a página 1. El resumen de filtros activos sigue visible cuando se cierra el panel. La paginación solo aparece si hay otra página o se está después de la primera.
9. Abre la sección Bloqueos, selecciona un consultorio y abre Retirar bloqueo. Actualiza los bloqueos:
   la confirmación anterior debe cerrarse y exigir seleccionar nuevamente el
   bloqueo. Al confirmar retiro, el botón indica Retirando bloqueo y queda
   deshabilitado. Verifica que un doble toque no envíe dos operaciones.

## Validación automatizada

Formularios administrativos: intenta guardar un consultorio con nombre vacío y
precio cero. Ambos campos deben mostrar su error debajo y quitarlo al corregirlo.
En Crear bloqueo, usa inicio 07 y fin 22; después inicio 12 y fin 11: los errores
deben corresponder a los campos afectados. Al corregir el inicio se revalida también
la relación con el fin. No se envía la operación mientras haya errores locales.
Los fallos de conexión/permisos siguen como mensajes generales. Comprueba lectura
con teclado abierto y tamaños de texto grandes en iPhone.

Backend: `node node_modules/jest/bin/jest.js --runInBand`.
Mobile: `npm test` y `npm run typecheck`.

`backend/src/reservations/admin-agenda.spec.ts` usa HTTP, JWT reales de prueba y Prisma simulado. Comprueba 401/403, revocación de rol, rechazo de refresh tokens, validación de filtros, límites del día, paginación y proyección de vencimiento. No se conecta a la base de datos de desarrollo ni a Stripe. La interacción en iPhone se verifica manualmente.

## Revisión del panel simplificado

- ADMIN ve tres accesos, sin el catálogo de reserva del doctor. DOCTOR conserva catálogo y Mis reservas.
- Las tres secciones tienen navegación consistente y mantienen la autorización existente.
- Agenda muestra primero fecha y reservas; filtros y referencias se despliegan bajo demanda.
- Los botones secundarios y destructivos se distinguen del botón principal.
- Bloqueos exige elegir consultorio y día; el formulario abre con Bloquear un horario.
- Probar calendario en teléfono pequeño, orientación horizontal y texto grande; se puede desplazar y cerrar.
- Verificación local: TypeScript y las 49 pruebas existentes. Revisión visual web a 390 px con datos ficticios; la interacción nativa en iPhone queda por comprobar.
