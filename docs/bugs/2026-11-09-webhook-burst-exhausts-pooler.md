# A Resend webhook burst exhausts the database pooler

**Date:** 2026-11-09
**Status:** Mitigated (pending a re-run of the volume test)
**Severity:** Critical
**Last verified:** not yet; verify with the volume run after deploy
**Related:** Issue #80 (Oct 31 launch: import, address emails, recipient updates)

## Symptom

During the volume run (294 address-request emails from the `helloseanoliver2` test book), Resend sent its delivered/bounced/complained webhooks within a few seconds. 132 of the `/api/webhooks/resend` calls failed (`[wh] [resend] unhandled: Error`), leaving 58 contacts stuck at "Sent". For at least five minutes afterwards, any request that needed a new database connection failed too, for example `/admin/waitlist`:

```
Failed query: select email, status, source, requested_at, invitation_sent_at from private.list_waitlist()
[cause]: (EMAXCONN) max client connections reached, limit: 200
```

Pages served by an instance that already held a connection kept working, so the failure looked intermittent. The first run on 2026-11-04 hit the same error (first seen 2026-11-04 18:11 UTC), but nobody noticed.

## Root cause

`src/lib/db/admin.ts` created one postgres.js client per function instance with `max: 10`. The Supavisor pooler caps **client** connections at 200 (Postgres itself had 16 server connections at the time). The project runs on Fluid compute (checked 2026-11-09), so one instance serves many requests at once and opened up to 10 connections. The burst spread across enough instances that their connections passed 200. A suspended instance can't run its `idle_timeout` timer, so its connections stay open at the pooler until the instance is reclaimed. That's why the failure outlasted the burst.

## Reproduction

Send about 300 address requests to `@resend.dev` addresses from the test book through the dashboard. Within a minute, Vercel runtime errors show `EMAXCONN` on `/api/webhooks/resend`, and a fresh load of `/admin/waitlist` fails.

## Fix

`max: 1` in `src/lib/db/admin.ts`, everywhere (Vercel, local dev and tests), so each instance holds at most one pooler connection. With one connection, a `dbAdmin` or `withRls` call nested inside a transaction callback waits for its own connection until the idle-in-transaction limit below kills the outer transaction. None exists today (checked 2026-11-09), and because tests now run on the same one-connection pool, a future nested call fails the suite instead of stalling production. `approve-race.test.ts` builds its own 2-connection client, because it races two transactions on purpose, and `duringConcurrentEdit` in `src/lib/agent/write.test.ts` edits through its own client so the row-lock tests still run the edit and the agent action at the same time.

Because every request on an instance now shares one connection, one slow or stuck transaction would hold up all of them. `withRls` and `adminTransaction` (`src/lib/db/admin.ts`) set `statement_timeout` and `idle_in_transaction_session_timeout` to 10s for the transaction only, so it fails and frees the connection. A lint rule bans calling `dbAdmin.transaction` directly.

## Verification

Pending: deploy, then re-run the volume test (re-send to the 254 test contacts) and confirm that every row reaches a terminal status and that Vercel shows no `EMAXCONN`.

## Recurrence guardrail

`src/lib/db/admin-pool.test.ts` fails if the pool holds more than one connection, and `src/lib/db/tx-limits.test.ts` fails if a transaction loses its limits, if they leak past commit, or if the pool can't recover from a cancelled statement. `src/lib/db/admin-lint.test.ts` fails if the lint rule stops catching a bare `dbAdmin.transaction`. The volume run in #80 is the end-to-end check: re-run it after any change to the database client or the webhook route.

## Follow-ups

- If `max: 1` is not enough (too many instances), move to `pg` with `attachDatabasePool` from `@vercel/functions`, which keeps the instance alive long enough to close idle connections. postgres.js isn't supported by that helper.
- Resend retries failed webhooks with backoff, so the stuck rows should recover on a retry. Confirm this after the re-run.
