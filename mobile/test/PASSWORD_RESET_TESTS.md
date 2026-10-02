# Password recovery

Automated: `npm test` exercises field validation, token parameters, exact request
payloads on public endpoints, cooldown boundaries, duplicate submission and
uncertain network outcomes. `npm run typecheck` and Expo export check the screens.
These checks do not prove native link opening, email receipt, or device UX.

Manual device checklist:

1. From login, open “Olvidé mi contraseña”. Invalid email stays beside its field.
   Enter an exact registered email, submit once, and check the uniform message and
   disabled resend for 60 seconds. Unknown email must display the same response.
2. Navigate away/back and try the same email: wait remains during this app run.
   Background/foreground the app: remaining time derives from an absolute clock.
3. With a development build using the existing `mobile` scheme, open
   `mobile://reset-password?token=<test-token>` with the app closed and open.
   Expo Go uses `exp://<Metro-host>:8081/--/reset-password?token=<test-token>`.
   Never use real users/tokens in screenshots, logs, or committed files.
4. Missing, repeated and malformed token parameters offer a new link. A valid
   token shows password and confirmation fields, each with the visibility toggle.
   Short/mismatched passwords must not submit. Expired/used tokens show the same
   invalid-link message and offer another request.
5. Submit a valid token, then return to login. Old password must fail; new password
   must work. Open another link while the reset screen is already open and verify
   previous form state does not carry over. Test with an existing session too.
6. Test offline/timeouts, 429 and server errors; there are no automatic retries.
   A reset timeout is ambiguous: try login with the new password before resetting
   again. A failed forgot request still waits 60 seconds because the server might
   have received it. Local cooldown is advisory and resets on full app restart;
   server cooldown/rate limits remain authoritative.

Integration limitations: backend currently accepts only HTTP(S) reset destinations.
Do not set `PASSWORD_RESET_URL=mobile://...`; no backend validation was weakened.
Custom-scheme/Expo Go links can be tested with synthetic tokens from the test setup.
Real email-to-app delivery needs an agreed HTTPS destination and Universal Links /
App Links (or a separately reviewed bridge). No email credentials, domain, bridge,
or production link configuration is introduced by this change.
