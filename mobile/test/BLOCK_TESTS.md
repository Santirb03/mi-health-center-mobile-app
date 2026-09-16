# Bloqueos desde la agenda

En Agenda del administrador, selecciona un consultorio y una fecha. La sección Bloqueos muestra los intervalos que intersectan ese día, incluso bloqueos de varios días creados previamente. No depende del filtro de estado de reservas.

El formulario crea bloqueos futuros de un solo día, en horas completas entre 08 y 21 de Ciudad de México. El motivo es opcional. Consultorios inactivos permiten consulta y retiro, pero no creación. Retirar un bloqueo requiere confirmación en pantalla y no modifica reservas.

Usa GET/POST `/rooms/:id/blocks` y DELETE `/rooms/:id/blocks/:blockId`. Los tres endpoints verifican JWT y rol ADMIN actual en base de datos. La creación conserva la transacción y bloqueo de concurrencia existentes: rechaza cruces con reservas confirmadas, retenciones vigentes u otros bloqueos. No hay migraciones ni dependencias nuevas.

Las mutaciones tienen protección de doble toque y no se reintentan automáticamente tras errores de red. Se vuelve a consultar la lista después de cada intento; ante un resultado incierto, revisa la lista antes de reintentar.

## Prueba manual

1. Inicia sesión como administrador. En la agenda selecciona un consultorio activo, mañana y un intervalo libre (por ejemplo 10 a 12). Crea un bloqueo con motivo Mantenimiento.
2. Verifica el intervalo y motivo en la lista. Desde disponibilidad del consultorio, ese intervalo debe aparecer no disponible después de actualizar.
3. Intenta otro bloqueo que se cruce: debe rechazarse. Prueba también sobre una reserva confirmada o una retención vigente: no debe alterar la reserva existente.
4. Toca Retirar bloqueo y después Conservar bloqueo: debe permanecer. Confirma el retiro: debe desaparecer, y disponibilidad debe liberarse si no existe otra ocupación.
5. Comprueba horario inverso, pasado y fuera de 08–21. Cambia día y consultorio: no deben mezclarse formularios ni resultados.
6. Con cuenta DOCTOR no debe existir acceso a estas operaciones. Si falla la conexión, debe mostrarse error y permitir actualizar, sin afirmar que la operación tuvo éxito.

## Verificación automatizada

Mobile: `npm test` y `npm run typecheck`. `blocks.test.cjs` comprueba conversión UTC-06, límites temporales y bloques que cruzan fechas.
Backend: `node node_modules/jest/bin/jest.js --runInBand`. Incluye la suite existente de conflictos/disponibilidad y pruebas HTTP de autenticación, revocación de privilegios y autorización de las tres operaciones. Las pruebas usan dobles de base de datos; no modifican reservas reales.
