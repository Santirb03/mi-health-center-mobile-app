# Revisiones automáticas

`.github/workflows/ci.yml` ejecuta GitHub Actions en cada push, pull request o ejecución manual. No despliega la aplicación. Usa Node 22.16.0 y `npm ci` con los archivos de dependencias bloqueadas.

## Qué revisa

- Backend: generación y validación de Prisma, tipos, pruebas unitarias y compilación.
- PostgreSQL: trabajos independientes para pagos, concurrencia de sesiones, flujos HTTP E2E, ensayo de despliegue (migraciones Prisma y arranque compilado) y respaldo/restauración con datos ficticios.
- Mobile: pruebas, exportación de bundles Android/iOS/web y tipos. La exportación no sustituye una compilación nativa ni las pruebas en un teléfono.

Cada suite de integración crea su propio contenedor PostgreSQL 16, aplica las migraciones y elimina el contenedor al terminar. Requiere Docker. Stripe está simulado: no se necesitan secretos de GitHub ni una cuenta de Stripe.

`npm run test:e2e` ahora usa ese entorno aislado. Su configuración rechaza la ejecución directa de Jest sin el entorno preparado; AppModule no carga `.env` durante esta suite. El cliente Stripe conserva la validación local de firmas, pero las operaciones de pago están simuladas y las llamadas de red restantes se rechazan.

## Comandos locales

Desde `backend`:

```sh
npm run typecheck
npm test -- --runInBand
npm run build
npm run test:payments:integration
npm run test:auth:integration
npm run test:e2e
npm run test:backup
```

Desde `mobile`:

```sh
npm test
npx expo export --platform all --output-dir .expo/ci-export
npm run typecheck
```

En CI, Expo tiene desactivada la carga de `.env` y usa una URL ficticia. Los bundles de comprobación no se publican.

`test:backup` tiene su propio runner y configuración Prisma sin dotenv: crea dos
bases en un contenedor desechable, respalda una y restaura en la otra. Comprueba
datos y restricciones sin acceder a la base de desarrollo. No sube archivos de
respaldo como artefactos. Ver [procedimiento y límites](backend/BACKUP_RESTORE.md).

## Pendiente

Lint todavía no bloquea el CI: la revisión inicial encontró 3677 errores y 50 advertencias existentes, principalmente de formato. `npm run lint:check` en backend permite inspeccionarlos sin modificar archivos. Las reglas existentes se conservan; su limpieza debe hacerse en un cambio separado antes de agregarla como requisito del CI.

La primera ejecución real en GitHub debe comprobarse en la pestaña Actions después del push. Las comprobaciones locales no garantizan que el entorno Linux de GitHub pase. Para exigir CI antes de integrar cambios se deberán configurar las reglas de protección de la rama en GitHub.
