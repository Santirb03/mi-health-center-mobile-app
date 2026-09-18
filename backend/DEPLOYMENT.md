# Despliegue de prueba

Procedimiento para una instancia del backend y PostgreSQL 16 separados de desarrollo. Aún no selecciona proveedor ni publica servicios. Usa Node 22.16.0 (igual que CI), HTTPS y Stripe de prueba. Configuración: [CONFIGURATION.md](CONFIGURATION.md).

## Preparar el artefacto

Selecciona un commit con CI verde. Desde backend, con DATABASE_URL definida en el entorno de build:

```sh
npm ci --include=dev
npm run prisma:generate
npm run build
```

La compilación necesita devDependencies aunque NODE_ENV sea production. El artefacto requiere dist, node_modules con el cliente Prisma generado, package.json, package-lock.json, prisma.config.ts y prisma/migrations junto con el schema. Conserva inicialmente las dependencias completas; optimizar la imagen es otra entrega. Genera e instala en el mismo sistema operativo que ejecutará el servidor.

## Configurar staging

Configura NODE_ENV=production, DATABASE_URL de staging, JWT_SECRET aleatorio de al menos 32 caracteres, STRIPE_SECRET_KEY de prueba y STRIPE_WEBHOOK_SECRET del endpoint publicado. El proveedor normalmente asigna PORT. No uses el secreto del listener local para el webhook publicado. Configura TRUST_PROXY_IPS solo después de verificar la topología del proveedor. Mantén una instancia mientras los límites se almacenen en memoria.

## Aplicar migraciones y arrancar

Ejecuta una única fase de migración por entrega con la misma versión de código y DATABASE_URL del servidor. Antes de actualizar una base con datos, revisa el SQL y confirma un backup recuperable.

```sh
npm run migrate:deploy
npm run migrate:status
npm run start:prod
```

Detente si cualquier comando falla. migrate:deploy aplica migraciones existentes; no crea migraciones ni genera el cliente. No uses migrate dev, migrate reset ni db push en el entorno publicado. Una base existente sin historial requiere un procedimiento de baseline revisado; no marques migraciones como aplicadas automáticamente.

Configura el proveedor con backend como directorio de trabajo, el comando de build anterior, migrate:deploy como fase previa al arranque y start:prod como proceso persistente. Las migraciones no se ejecutan automáticamente al iniciar cada réplica. CI no despliega.

## Verificar la entrega

Comprueba por HTTPS /health y /health/ready (ambas deben devolver 200), consulta los logs sin exponer secretos y verifica registro/login. Configura en Stripe de prueba el endpoint /payments/webhook y los eventos payment_intent.succeeded, payment_intent.payment_failed y payment_intent.canceled. Prueba una reserva y un pago desde el teléfono, confirmando el estado en la agenda. Ningún healthcheck confirma por sí solo que Stripe funcione. La app debe apuntar a la URL HTTPS publicada.

## Ensayo local aislado

Con Docker disponible y el backend compilado:

```sh
npm run test:deployment
```

El runner crea PostgreSQL temporal, ejecuta migrate deploy dos veces, comprueba migrate status y arranca el JavaScript compilado con credenciales ficticias para verificar salud. Finalmente cierra su servidor y elimina su contenedor. No usa la base de desarrollo ni llama a Stripe. No es una prueba de backups, actualización desde una copia de producción ni despliegue remoto.

## Si falla una entrega

No dirijas tráfico al nuevo proceso si readiness falla. Si falla una migración, detén la entrega y revisa su causa antes de volver a intentarlo. No borres ni alteres migraciones ya aplicadas. Volver al código anterior no revierte el esquema: solo hazlo si sigue siendo compatible. Los cambios destructivos requieren un plan explícito de recuperación; probar restauración y configurar backups queda pendiente al elegir proveedor.

Referencia: [Prisma migrate deploy v7](https://www.prisma.io/docs/cli/v7/migrate/deploy).
