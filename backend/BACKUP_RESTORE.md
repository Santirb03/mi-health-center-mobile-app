# Respaldo y recuperación

Esta entrega prueba recuperación lógica de PostgreSQL 16 con el esquema actual.
No configura respaldos automáticos, no copia la base de desarrollo y no migra
usuarios del sistema viejo. El destino de producción todavía no está definido.

## Ejecutar el ensayo

Con Docker Desktop iniciado, dependencias instaladas y el cliente Prisma generado,
desde `backend`:

```sh
npm run test:backup
```

El runner no acepta URLs ni rutas como argumentos. Genera sus propias credenciales,
puerto local y contenedor `mhc-backup-test-<uuid>`. No carga `.env`; su configuración
Prisma separada usa exclusivamente las dos bases del ensayo. No llama a Stripe.

1. Levanta PostgreSQL 16 temporal, con datos en tmpfs y sin volumen persistente.
2. Aplica las migraciones reales con Prisma Migrate a `mhc_backup_source`.
3. Crea usuarios DOCTOR/ADMIN, perfil, consultorio, reservas, pago, bloqueo,
   paciente, cita y evento Stripe ficticios. Los hashes de contraseña son marcadores,
   no credenciales válidas; este ensayo no prueba login.
4. Genera un archivo custom con `pg_dump`, lee su catálogo con `pg_restore --list`
   y calcula SHA-256. El archivo permanece dentro del contenedor.
5. Crea un usuario adicional después del respaldo.
6. Restaura en `mhc_backup_restored`, recién creada y vacía, con transacción única
   y salida inmediata ante error. No usa `--clean` ni reemplaza una base existente.
7. Compara todos los registros de todas las tablas públicas, incluidos IDs,
   importes, fechas y `_prisma_migrations`; compara constraints, índices y enums.
   Comprueba el estado de migraciones y que las restricciones de relación y email
   único rechacen escrituras inválidas. El usuario posterior no debe aparecer.
8. Cierra conexiones y elimina su contenedor y archivo, incluso ante fallos normales.

El comando termina con código distinto de cero si falla alguna comprobación.
CI lo ejecuta como `PostgreSQL (backup)` en cada push/PR. Si se agrega una tabla
sin datos ficticios, el ensayo falla para exigir cobertura de ese nuevo modelo.
Una interrupción forzada del proceso o Docker puede impedir la limpieza: revisa
`docker ps -a` y detén únicamente el contenedor de ensayo identificado. Nunca uses
un borrado general de contenedores o volúmenes para limpiar esta prueba.

## Procedimiento para staging y producción (pendiente de adaptar al proveedor)

Antes de operar datos reales hay que decidir responsable, frecuencia, retención,
ubicación cifrada fuera del servidor, control de acceso y alertas de fallos.
También definir cuánto dato se admite perder (RPO) y cuánto tiempo puede durar
la recuperación (RTO). El ensayo pequeño no mide tiempos para una base real.

La secuencia operativa será:

1. Identificar por escrito origen, destino, versiones de PostgreSQL, commit de la
   aplicación y migraciones. Preparar credenciales específicas; no incluirlas en
   Git, comandos compartidos ni logs. No asumir que las del ensayo sirven fuera.
2. Crear el respaldo lógico con `pg_dump --format=custom --file=<archivo>`, usando
   herramientas compatibles con el servidor. Registrar hora de inicio/fin,
   tamaño, checksum y resultado. Proteger el archivo como los datos originales;
   la compresión no es cifrado. El checksum detecta cambios, no certifica que el
   origen sea confiable ni que se pueda restaurar.
3. Crear otra base vacía y aislada. Verificar explícitamente su dirección/nombre.
   Restaurar con `pg_restore --dbname=<destino> --exit-on-error --single-transaction
   --no-owner --no-acl <archivo>`. Aquí las opciones representan un procedimiento,
   no un comando listo para copiar contra producción. No restaurar sobre la base
   en operación ni utilizar `--clean` como atajo.
4. Verificar registros por entidad, relaciones, importes, fechas, migraciones y
   lectura desde la aplicación con la versión compatible. El ensayo automatizado
   comprueba esos datos, pero no sustituye probar login/reservas en staging.
5. Configurar permisos del destino y validar salud. Durante una recuperación real,
   reconciliar pagos/eventos de Stripe posteriores al respaldo antes de habilitar
   cobros o reservas: recuperar PostgreSQL no revierte operaciones externas.
6. Cambiar la aplicación al destino solo después de validar y autorizar el corte.
   Conservar la base original y un plan de vuelta compatible; un restore no es
   una herramienta para deshacer automáticamente cambios de esquema.

`pg_dump` respalda una base, no roles globales, configuración del servidor,
secretos de la aplicación ni archivos externos. El ensayo omite ownership/ACL;
los roles y permisos reales deben prepararse aparte. Tampoco configura recuperación
a un instante mediante WAL/PITR; esa capacidad dependerá del proveedor.

## Plan acordado para usuarios del sistema viejo

- Primera copia: preservar un respaldo original y trabajar en una copia aislada.
  Revisar modelo de usuarios, IDs, emails, roles y compatibilidad de hashes antes
  de diseñar la importación. No ejecutar migraciones del proyecto nuevo sobre la
  base vieja ni asumir que un dump se puede restaurar directamente en otro esquema.
- Preparar importación repetible con correspondencia de IDs y reglas verificadas
  para altas, actualizaciones y duplicados; validar acceso de los usuarios.
- Antes del lanzamiento: pausar registros y demás escrituras relevantes en el
  sistema viejo, tomar un respaldo final e incorporar diferencias respecto de la
  primera copia. Comprobar conteos, identidades y acceso antes de activar la nueva
  aplicación. Confirmar también qué reservas vigentes deben trasladarse.
- Esta entrega no implementa ese importador. La prueba del usuario creado después
  del dump demuestra por qué una copia inicial no incluye altas posteriores.

Referencias oficiales: [pg_dump 16](https://www.postgresql.org/docs/16/app-pgdump.html)
y [pg_restore 16](https://www.postgresql.org/docs/16/app-pgrestore.html).
