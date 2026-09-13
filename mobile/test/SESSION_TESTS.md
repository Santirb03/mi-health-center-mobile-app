# Mobile session regression tests

From `mobile`:

```sh
npm test
npm run typecheck
```

The Node test runner uses the installed TypeScript compiler to transpile pure
service modules in memory. Axios adapters and token storage are simulated; tests
never contact the backend or write credentials. No additional dependency is needed.

Covered: concurrent 401s, missing/rejected refresh tokens, connectivity failures,
late responses after logout or account changes, bounded retries, storage write
races, incomplete stored credentials, and safe Spanish error messages.

## Session behavior

- SecureStore retains the existing `accessToken` and `refreshToken` keys.
- Startup restores the pair and validates access through the existing
  `GET /protected` endpoint. An expired access token uses `POST /auth/refresh`.
- A rejected refresh clears local credentials and removes protected screens.
- A startup network failure shows retry and sign-out options without deleting
  otherwise valid credentials. Returning from background also checks access.
- Login uses a separate Axios client, so incorrect credentials cannot trigger
  refresh. Every normal API request retries at most once.
- Session versions discard results from a previous login/logout; serialized
  storage writes prevent an outstanding save from restoring a logged-out session.
- Logout clears local state before attempting server revocation. The login UI
  stays gated until that request finishes. Remote revocation still needs a valid
  access token and network connectivity; backend refresh/logout races are outside
  this mobile change.
- A network failure after the server rotates a refresh token can still require
  signing in again if the response is lost. Resolving that needs backend support.

## Environment

Copy `.env.example` to `.env.local` and set `EXPO_PUBLIC_API_URL` to your backend.
The physical device must be able to reach that address. The variable is public;
never put JWT signing secrets, Stripe secret keys, or database credentials here.
For EAS, set it in the selected build environment. Restart Expo after changes.

This implementation uses `Stack.Protected`, supported by the installed Expo
Router 6 / SDK 54. It does not upgrade Expo.

## Device checks (not replaced by service tests)

1. Cold start without credentials opens login; a direct `/home` link cannot enter.
2. Login opens Home; Back cannot return to login.
3. Restart with an expired access token renews the session before entering Home.
4. With invalid refresh credentials, return to login and verify Back cannot enter Home.
5. Start offline with stored credentials: show retry; reconnect and retry successfully.
6. Home shows an error/retry when requests fail and an empty state for an empty list.
7. Logout during pending requests cannot restore the previous screen or session.
8. Verify SecureStore and foreground behavior on both Android and iOS.

The service suite does not render native navigation or verify device SecureStore.
