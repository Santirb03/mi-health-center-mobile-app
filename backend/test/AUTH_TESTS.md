# Refresh rotation and logout

## Guarantee

After validating a refresh JWT and its stored Argon2 hash, rotation uses one conditional PostgreSQL update matching both user id and the previously read hash. A token pair is returned only if exactly one row changed.

- Two simultaneous refresh requests with the same token: one succeeds; the loser receives 401 and does not overwrite or clear the winner's hash.
- Logout writes a null hash. A refresh that validated the old hash before logout cannot restore it afterward.
- If refresh commits first, a subsequent logout clears the new hash and the newly issued refresh token stops working.
- A new password login replaces the hash, so an older in-flight refresh cannot overwrite that session.
- Replaying an old refresh token does not revoke the winning session.
- Database read/write or token-signing failures remain server errors instead of being translated into a misleading 401.

No migration, new dependency, endpoint, or mobile change is required. Token lifetimes remain 15 minutes / 14 days. The account still has one stored refresh session. A password login deliberately starts a new session; this change is not a multi-device session registry. Logout does not immediately revoke already issued access tokens, which remain subject to expiration and existing guards.

## Commands (from backend)

```sh
node node_modules/jest/bin/jest.js --runInBand
npm run test:auth:integration
```

The integration command reuses `run-payment-integration.cjs --auth` to create a disposable PostgreSQL 16 container, apply versioned migrations, run only the auth suite, and remove the container. It never loads the application's `.env`. Docker must be available. The payment suite remains available via `npm run test:payments:integration`.

`auth-concurrency.integration-spec.ts` uses two independent Prisma clients, actual JWT signing and Argon2 hashes. Explicit barriers pause requests immediately before the conditional update; the update itself runs against PostgreSQL. Tests inspect persisted hashes and verify token usability afterward. They require the isolated runner and refuse to run against the normal application database.

The unit suite also checks failed conditional writes and propagation of storage errors. No real accounts or Stripe calls are involved.
