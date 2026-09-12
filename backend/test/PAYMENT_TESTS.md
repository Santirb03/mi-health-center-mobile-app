# Reservation and payment concurrency regressions

Run from `backend`:

```sh
npm test -- --runInBand
npm run test:payments:integration
```

The integration command requires a running Docker engine and the `postgres:16`
image (Docker downloads it if absent). It creates a uniquely named, disposable
container with a random password and a dynamic port bound to localhost. It reads
the repository's SQL migrations into that empty database, runs Jest, and stops
the container on completion or test failure. No application `.env` is loaded and
no existing database is migrated, reset, or cleaned. If the runner is forcibly
terminated, the remaining container can be identified by its `mhc-payment-tests-`
prefix and removed manually.

This is a service integration suite: PostgreSQL, Prisma transactions and advisory
locks are real; Stripe responses are mocked. It does not verify HTTP guards,
webhook signature validation, Stripe settlement, or mobile checkout.

## Invariants

- Confirmation checks reservations and administrative blocks under the same
  room lock as reservation/block creation.
- Reads before acquiring the lock only locate the room. Payment and reservation
  status are read again after acquiring it.
- Cancellation and on-demand hold expiration participate in that lock protocol.
- A late failure event cannot downgrade a `PAID` or `REFUNDED` payment. The status
  predicate is part of the database update, not a separate check.
- Concurrent success events do not process a terminal payment twice.

Concurrency tests hold a PostgreSQL advisory lock from a separate connection,
start competing service calls, and wait until `pg_locks` shows them blocked before
releasing the lock. A bounded polling loop detects synchronization; the tests do
not assume that a fixed delay is enough for requests to overlap. Assertions check
persisted outcomes, not just whether a lock function was called.

## Deliberately unchanged

The existing cancellation policy still permits cancelling confirmed reservations;
this does not automatically refund an already-paid reservation. This suite checks
that cancellation is not overwritten, without introducing a new refund policy.

Refunds still use the existing synchronous Stripe call inside the transaction.
Durable refund processing, pending/failed refunds, and reconciliation after an
external success followed by database failure require a separate change. Passing
this suite is not a production-readiness claim.
