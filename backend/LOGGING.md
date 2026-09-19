# Diagnóstico HTTP

Cada solicitud que alcanza el middleware de rutas recibe X-Request-Id generado por el servidor. Los valores enviados por clientes se ignoran. Ante un error se puede buscar ese identificador en los logs del proceso. Los errores rechazados antes de ese middleware (por ejemplo JSON malformado en el parser de Express) conservan un 4xx sanitizado, pero no tienen este registro de correlación.

Al terminar una respuesta 4xx o 5xx se escribe un registro JSON con event, requestId, method, route, statusCode y durationMs. route es el patrón registrado (por ejemplo /reservations/:id) o unmatched; nunca la URL completa. 4xx usa nivel warn y 5xx error. Las respuestas exitosas no generan estos registros.

No se registran cuerpos, parámetros, consultas, IP, cabeceras, cookies, tokens, contraseñas, mensajes de excepción ni stacks. Los fallos 5xx reciben un mensaje genérico; 4xx conserva el contrato de validación/autenticación y Retry-After. El filtro sustituye el registro automático de excepciones HTTP de Nest para evitar imprimir detalles internos.

El alcance son respuestas HTTP terminadas: no reemplaza la supervisión de arranque, procesos fuera de HTTP ni conexiones abortadas. No configura almacenamiento, retención o alertas externas; eso se definirá con el proveedor. El cliente móvil todavía no muestra el identificador al usuario. Para diagnóstico técnico puede consultarse en las cabeceras de la respuesta.
