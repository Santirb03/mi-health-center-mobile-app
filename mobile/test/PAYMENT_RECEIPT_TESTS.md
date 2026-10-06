# Comprobante de pago

Pruebas automatizadas: `npm test` y `npm run typecheck` desde mobile. Los fixtures de React Native verifican selección, cierre, texto compartido, cancelación, errores y bloqueo temporal del botón. No sustituyen una prueba nativa.

Verificación realizada el 6 de octubre de 2026: `npm test` pasó con 141 pruebas y cero fallos; `npm run typecheck` terminó con código 0. La mutación temporal que incluía pending en succeededRefundCents fue detectada (1800 en lugar de 1200, código 1). Se restauraron los bytes originales: `git diff --no-index` contra la copia previa terminó con código 0. Las 10 pruebas del comprobante volvieron a pasar tras la restauración.

La exportación de Expo para iOS, Android y web terminó con código 0 y 19 rutas estáticas. El primer intento falló porque Hermes no pudo escribir un archivo temporal del sandbox; se repitió fuera de esa restricción. Los resultados quedan en .expo/ci-export, ignorado por Git.

## Pruebas manuales pendientes — NO VALIDADO EN DISPOSITIVO

- Abrir «Ver comprobante» desde distintos pagos y cerrar con «Cerrar».
- En Android, cerrar con el botón atrás; comprobar que vuelve a Mis pagos.
- Compartir en iOS y Android y comprobar que el texto coincide con las etiquetas y valores en pantalla; cancelar sin mostrar error.
- Revisar un consultorio con nombre largo: debe poder leerse completo al desplazar el contenido.
- Revisar un reembolso parcial: 150.10 pagado y 3000 centavos reembolsados muestran neto 120.10.
- Revisar devoluciones pendientes: aparecen como cantidad de devoluciones en proceso y no reducen el neto.
- Revisar un pago sin paidAt: muestra «Fecha de pago no registrada».
- Con VoiceOver/TalkBack, verificar que se anuncia «Comprobante de pago», el foco permanece dentro del modal y permite cerrarlo.

## Decisiones y limitaciones

- Se reutiliza el pago cargado; abrir el comprobante no hace otra petición.
- «Devoluciones en proceso» representa el número de devoluciones pending/requires_action, no su importe.
- Los cálculos usan centavos enteros; importes fuera del rango de enteros seguros se rechazan. Solo succeeded reduce el neto.
- El comprobante es informativo, sin validez fiscal, RFC ni nombre del pagador. Se comparte texto plano y no se genera PDF ni archivo.
- Los contactos vacíos se omiten. El dueño debe completar los contactos reales y revisar la leyenda antes de producción en src/config/business.ts.
- La fecha UTC 2026-10-06T02:00:00Z corresponde a lunes 5 de octubre en Ciudad de México.
- La entrega real del menú de compartir y el comportamiento del foco siguen pendientes de validar en dispositivo.
