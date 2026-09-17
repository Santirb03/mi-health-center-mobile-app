# Gestión de consultorios

Desde inicio, las cuentas ADMIN pueden abrir **Gestionar consultorios**. Muestra activos e inactivos, permite crear y editar nombre, descripción y precio por hora, y activar/desactivar con confirmación.

## Reglas

- Nombre de 2 a 120 caracteres, descripción opcional de hasta 2000.
- Precio en MXN mayor a cero, hasta dos decimales y máximo 99999999.99 (límite del campo en base de datos). El formulario acepta punto o coma decimal, sin separadores de miles. Los precios nuevos de cero ya no son válidos porque el checkout requiere un importe positivo.
- Desactivar impide nuevas reservas y oculta el consultorio del catálogo público. Conserva bloqueos, reservas y pagos existentes; una retención previa sigue las reglas existentes de pago y vencimiento.
- Los cambios de precio no recalculan reservas existentes. La creación de reservas vuelve a leer precio y estado dentro del mismo bloqueo de concurrencia usado al editar consultorios. Se rechazan totales que excedan el campo de importe.
- PATCH `/rooms/:id` admite `active` booleano. DELETE continúa siendo desactivación, sin borrado físico. POST, PATCH y DELETE validan el rol ADMIN actual.
- GET `/admin/rooms` agrega descripción y precio al listado administrativo. Al volver al inicio, se actualiza el catálogo.
- No hay migraciones ni dependencias nuevas. Los formularios no reintentan mutaciones automáticamente tras un timeout: consulta el listado antes de repetir una creación con resultado incierto.

## Prueba en iPhone

1. Con backend y Expo actualizados, inicia sesión como administrador y abre Gestionar consultorios.
2. Crea un consultorio de prueba a 250.50 MXN/hora. Verifica nombre, descripción y precio en el listado y en inicio.
3. Edita descripción y precio. Vuelve al inicio y verifica que se actualicen. Una reserva existente conserva su total; una nueva usa el precio actualizado.
4. Toca Desactivar y cancela: debe continuar activo. Confirma la desactivación: permanece visible como inactivo en administración, pero desaparece del catálogo al volver a inicio.
5. Actívalo y comprueba que regrese al catálogo.
6. Prueba nombre vacío y precios 0, negativos o con tres decimales: no deben guardarse.
7. Con cuenta DOCTOR, no debe aparecer Gestionar consultorios y el backend debe rechazar sus mutaciones.

## Pruebas automatizadas

Backend: `node node_modules/jest/bin/jest.js --runInBand`.
Integración con PostgreSQL desechable y Stripe simulado: `npm run test:payments:integration`.
Mobile: `npm test` y `npm run typecheck`.

Se cubren permisos por HTTP, validación del precio/activación y lectura de estado/precio después del bloqueo de concurrencia. La interacción de la pantalla requiere prueba manual en iPhone.
