# QA de pacientes — entrega 5C

**NO VALIDADO EN DISPOSITIVO.** Los casos manuales siguientes están pendientes; las pruebas de Node no validan teclado, render nativo ni VoiceOver.

## Casos manuales pendientes

- [ ] Listado vacío: «Aún no tienes pacientes registrados.»
- [ ] Crear paciente con nombre/apellidos; opcionales vacíos omitidos; abrir detalle.
- [ ] Crear con teléfono nacional, +52 y separadores; comprobar contacto guardado.
- [ ] Doble pulsación rápida de guardar: una sola solicitud.
- [ ] Editar: datos actuales precargados; sin modificaciones, «Sin cambios» y guardar deshabilitado.
- [ ] Cambiar un campo y verificar PATCH mínimo; limpiar teléfono, correo o nacimiento y verificar null.
- [ ] Volver al detalle después de guardar y comprobar información actualizada.
- [ ] Búsqueda de un carácter: mostrar ayuda y ocultar tarjetas previas inmediatamente.
- [ ] Buscar con dos caracteres, nombre/apellido en términos separados y espacios repetidos.
- [ ] Búsqueda sin resultados: mensaje específico.
- [ ] Consulta de más de 80 caracteres o más de cuatro palabras: ayuda, sin consulta ni truncamiento.
- [ ] Más de 20 pacientes: cargar páginas sin duplicados y sin modificar el orden.
- [ ] Cambiar búsqueda durante «Cargar más»: abortar y no reutilizar cursor.
- [ ] Limpiar búsqueda: volver al listado completo después del debounce.
- [ ] Fecha 1990-01-01: detalle muestra 1 de enero de 1990 en México y en otra zona horaria.
- [ ] Fecha inválida, anterior a 1900, futura, correo/teléfono inválidos: errores junto al campo.
- [ ] Respuestas 400 del servidor: errores conocidos por campo; desconocidos con mensaje general seguro.
- [ ] Paciente ajeno/inexistente (404): «Este paciente ya no está disponible.» y regresar al listado.
- [ ] Desconectar red al leer, paginar y guardar: mensajes recuperables; no perder formulario al fallar guardado.
- [ ] Reintentar una página posterior: conservar pacientes y repetir el cursor fallido.
- [ ] 429 y 5xx: mensajes en español, con posibilidad de volver a guardar.
- [ ] Logout y login con otra cuenta: no aparecen nombres, contactos, búsqueda ni borradores anteriores.
- [ ] Cambiar cuenta con carga o guardado pendientes: respuesta antigua no modifica datos ni navega.
- [ ] Navegar entre IDs: nunca mostrar el detalle/formulario del paciente anterior.
- [ ] Volver a enfocar el listado: mantener texto y recargar su primera página.
- [ ] Búsqueda/correo sin autocorrector, capitalización ni autocompletado.
- [ ] iPhone: teclado phone-pad para teléfono, email para correo y texto con guiones para nacimiento.
- [ ] Teclado visible: campos y acciones siguen accesibles; verificar KeyboardAvoidingView.
- [ ] VoiceOver: etiquetas de campos, tarjetas y botones; errores anunciados; orden lógico de foco.
- [ ] Texto grande y contraste: comprobar legibilidad y tamaños de objetivos táctiles.

## Pruebas automatizadas

`patient-pager.test.cjs`: estados de consulta, abortos, generaciones, paginación, deduplicación, reintento exacto, debounce de 350 ms, refoco, desmontaje, cambio de identidad y contrato del cliente HTTP.

`patient-form.test.cjs`: validación, payload/PATCH mínimo, null, mensajes por campo y fechas civiles bajo America/Los_Angeles y Asia/Tokyo. La prueba comprueba que el runtime cambia realmente los getters locales.

Las mutaciones temporales de cursor y getters locales deben fallar; restaurar exclusivamente los archivos mutados y comprobar igualdad exacta antes de volver a verificar.

## Límites

- Backend autoriza y valida definitivamente. El teléfono y correo se validan de forma básica en móvil.
- No hay caché persistente ni datos personales en parámetros (solo ID).
- Una solicitud de escritura ya recibida por el servidor puede terminar tras salir de la pantalla; su respuesta no actualiza ni navega una sesión diferente.
- Si se pierde la respuesta de un POST, el cliente no puede saber si se creó: revisar el listado antes de reintentar. No se implementa idempotencia nueva en 5C.
- El listado usa Page/ScrollView existente; no incorpora virtualización adicional.
- No hay citas, eliminación, archivado, importación de contactos ni datos clínicos.
