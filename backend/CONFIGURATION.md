# Configuración del servidor

Copia `.env.example` a `.env` y completa las credenciales. En un servidor publicado, configúralas mediante el proveedor de despliegue. No subas secretos a Git.

El arranque valida DATABASE_URL (URL PostgreSQL con host y base), JWT_SECRET, STRIPE_SECRET_KEY (prefijo sk/rk de test/live) y STRIPE_WEBHOOK_SECRET (prefijo whsec). Rechaza valores vacíos y espacios exteriores sin modificar secretos. Los errores muestran nombres de variables, nunca sus valores.

NODE_ENV admite development, test o production; por defecto development. Para staging usa production y credenciales Stripe de prueba. En production JWT_SECRET requiere al menos 32 caracteres: usa un valor aleatorio, la longitud no garantiza seguridad. PORT admite enteros de 1 a 65535 y por defecto es 3000.

La validación comprueba formato y presencia; no demuestra que las credenciales funcionen ni que los servicios estén disponibles. Las pruebas HTTP usan sus propias credenciales ficticias y PostgreSQL temporal. No se modifican los .env existentes. Cambiar JWT_SECRET invalida los tokens anteriores.

Implementación mediante la función validate de ConfigModule: https://docs.nestjs.com/techniques/configuration

## Comprobaciones de salud

- `GET /health`: 200 con `{"status":"ok"}` cuando el proceso HTTP responde. No consulta la base de datos.
- `GET /health/ready`: ejecuta `SELECT 1`; devuelve 200 con `{"status":"ok","database":"up"}` o 503 con `{"status":"unavailable","database":"down"}` si falla o excede dos segundos.

Ambas rutas son públicas y no se almacenan en caché. No devuelven credenciales, versiones ni mensajes de error internos. El plazo limita la respuesta HTTP, no cancela la consulta; las solicitudes simultáneas comparten la consulta pendiente para no acumular trabajo. Una nueva consulta puede ejecutarse cuando termina la anterior.

Usa readiness para comprobar si la instancia puede atender tráfico y liveness para comprobar el proceso. Readiness no verifica Stripe, migraciones aplicadas ni permisos de escritura. Si el arranque falla (por configuración o conexión inicial), no habrá servidor HTTP disponible. La ruta `/` no es un healthcheck.
