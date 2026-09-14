# Mobile booking flow

Run `npm test` and `npm run typecheck` in mobile. Start Expo once after adding
routes so its ignored `.expo/types` declaration includes the new screens.

The booking tests cover Mexico City dates, contiguous selection, slots that
become past while selected, effective hold labels, and matching an existing
reservation after an ambiguous request. Session/client tests also assert that
reservation POSTs are not replayed on timeout or HTTP 500. No external requests
or database writes are made by these mobile tests.

## Behavior

- Home opens room details; all booking routes are protected by the session.
- Availability and room details reload on focus, foreground, and manual refresh.
- Selecting a later consecutive hour extends the range; another selection starts
  a new range. Gaps, blocked slots, and past slots cannot be submitted.
- Review shows an estimate. Creation sends only room and timestamps; the server
  computes the final amount. The result is a pending hold, not confirmation.
- A synchronous submission guard prevents double taps. Network/server failures
  trigger only a GET to look for an active reservation with the same interval.
  An unresolved result disables submission on that screen and links to My
  Reservations. This is recovery, not server-side idempotency across restarts.
- Pending holds past expiresAt are labelled as expired locally. Stored status is
  not rewritten: a delayed payment webhook may still need to reconcile it.
- The countdown uses device time and is explicitly advisory. Refresh reads server
  status. There is no checkout, automatic payment, or cancellation in this flow.

## Device acceptance checks (manual)

Use test accounts and a development database; creating a reservation writes data.

1. Login, open a room, change dates quickly, and verify old responses cannot
   replace the selected date. Test loading, offline/retry, empty and inactive room.
2. Select one hour, extend to several, then try crossing an unavailable hour.
   Verify the selected interval and estimated price before creating.
3. Use two doctors to select the same slot. After the first reserves it, the
   second should get updated availability and no duplicate occupied slot.
4. Double-tap create. Verify one submission, then final server price and reference.
5. Drop the connection while creating. Verify no automatic POST retry, recovery
   through the existing reservation when found, or the unknown-result message.
   Reconnect and inspect My Reservations before attempting another reservation.
6. Let a hold expire. Verify it remains unconfirmed; refresh status. Separately
   verify a confirmed reservation is never labelled expired by the countdown.
7. Background/foreground and navigate back during a request. Late data must not
   redirect away from a different screen or expose a previous account's data.
8. Open booking deep links while signed out; protected screens must remain gated.
9. Test Android and iOS with large font sizes and a device timezone different
   from Mexico City. Native navigation and SecureStore need device verification.
