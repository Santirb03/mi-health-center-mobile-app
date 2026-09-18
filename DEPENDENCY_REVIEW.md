# Revisión de dependencias — 2026-09-18

Auditoría npm del árbol completo: backend pasó de 11 entradas (10 altas, 1 moderada) a 4 altas; móvil mantiene 14 moderadas. Las entradas incluyen paquetes afectados indirectamente, no representan incidentes distintos ni demuestran explotación en esta app.

## Cambios

Actualizados fast-uri, js-yaml y qs dentro de los rangos admitidos por sus consumidores. Override acotado a @nestjs/platform-express para usar multer 2.3.0 y mantener Nest 11. Retirar el override cuando una versión compatible del adaptador incluya la corrección. No se encontraron interceptores de subida de archivos en src; no se afirma que el fallo estuviera expuesto por las rutas actuales.

## Pendientes

- Backend: deepmerge-ts, @prisma/config, mysql2 y prisma. Son cadenas de Prisma CLI/config; el backend usa PostgreSQL. No se identificó entrada HTTP que pase objetos cíclicos a deepmerge-ts ni uso de conexiones MySQL en src. Esto limita la exposición observada, no elimina los avisos. Revisar una actualización compatible de Prisma y repetir generación, migraciones y pruebas; no degradar a Prisma 6 ni forzar un cambio mayor de deepmerge sin validarlo.
- Móvil: decode-uri-component vía query-string/Expo Router. La corrección 0.5.0 es ESM, mientras query-string instalado usa require y espera una función. Se descartó el override directo para no romper el parseo. Hace falta una actualización compatible de la cadena de Router o un parche de compatibilidad probado. El riesgo de bloqueo con enlaces malformados sigue pendiente.
- Móvil: uuid vía xcode y herramientas Expo. xcode usa uuid.v4; el aviso describe v3/v5/v6 con buffer. No se observó esa ruta vulnerable en el consumidor inspeccionado. Revisar la actualización de herramientas con una compilación nativa antes de forzar una versión mayor de uuid.

No usar npm audit fix --force: las propuestas observadas incluyen Nest 12 y degradaciones de Prisma/Expo. Repetir npm audit en ambos directorios en la siguiente actualización. No se ha declarado el proyecto libre de vulnerabilidades ni listo para producción.

Fuentes: [multer](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm), [decode-uri-component](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr), [deepmerge-ts](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), [uuid](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
