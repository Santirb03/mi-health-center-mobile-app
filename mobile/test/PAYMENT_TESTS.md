# Checkout móvil de prueba

PaymentSheet permite pagar una reserva PENDING vigente. El importe lo determina el backend. La app solo muestra confirmación cuando GET de la reserva devuelve CONFIRMED; cerrar PaymentSheet correctamente no confirma por sí mismo.

## Configuración local

1. En `mobile/.env.local`, agrega `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_…` de la misma cuenta y entorno de prueba que el backend. Reinicia Expo después. La app rechaza claves live y claves secretas.
2. El backend necesita su `STRIPE_SECRET_KEY` de prueba. Nunca pongas esa clave en variables EXPO_PUBLIC.
3. Con Stripe CLI autenticado en ese mismo entorno, ejecuta `stripe listen --forward-to localhost:3000/payments/webhook`. Copia el signing secret que devuelve a `STRIPE_WEBHOOK_SECRET` del backend y reinicia el backend. Mantén el listener abierto.
4. Abre Expo Go en el iPhone. La URL pública de la API debe ser accesible desde el teléfono. Apple Pay y Google Pay no forman parte de este cambio.

## Verificación en iPhone

- Crea una reserva futura, abre su detalle y paga con la tarjeta de prueba `4242 4242 4242 4242`, vencimiento futuro y CVC de tres dígitos. Verifica que termine CONFIRMED y siga así tras volver a abrir la app.
- Cierra el formulario sin pagar: no debe mostrar confirmación ni cancelar la reserva. Puedes volver a abrir el pago mientras siga vigente.
- Prueba un rechazo y autenticación 3DS con las tarjetas de la [documentación oficial de Stripe](https://docs.stripe.com/testing). Verifica el regreso a la app y el estado del servidor.
- Toca pagar varias veces: solo debe abrirse un formulario.
- Espera a que venza una reserva sin pagar: el botón queda deshabilitado.
- Detén el listener antes de pagar una reserva nueva: la app debe terminar su espera indicando que falta confirmar, sin habilitar otro pago en esa pantalla. Reinicia el listener y reenvía el evento pendiente desde Stripe; actualiza para comprobar la confirmación del servidor.
- Interrumpe la red y vuelve a abrir el detalle: no debe inventar un resultado de pago. Revisa el estado antes de reintentar.

## Pruebas automatizadas

Desde `mobile`: `npm test` y `npm run typecheck`.

`checkout.test.cjs` cubre doble envío, confirmación exclusivamente del servidor, webhook tardío/ausente, vencimiento, cancelación, error de Stripe, cierre de sesión y fallo de red durante consulta. Usa dobles de Stripe y no hace cobros. No sustituye la prueba nativa de PaymentSheet, 3DS y webhook.

La consulta posterior al pago tiene hasta 12 intentos y un límite de 30 segundos. Si no hay confirmación, se conserva un resultado incierto. Los reembolsos operativos y el despliegue de pagos reales siguen fuera de este cambio.
