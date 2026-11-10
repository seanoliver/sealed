# A Resend webhook burst exhausts the database pooler

**Date:** 2026-11-09
**Status:** Mitigated (the minutes-long outage is fixed; a 2-second burst of webhook 500s remains, cause unconfirmed)
**Severity:** Critical
**Last verified:** `89a9041` on 2026-11-10 (volume run)
**Related:** Issue #80 (Oct 31 launch: import, address emails, recipient updates), PR #161 (first attempt), PR #164 (the fix), issues #163 and #165 (follow-ups)

## Symptom

During the volume run (294 address-request emails from the `helloseanoliver2` test book), Resend sent its delivered/bounced/complained webhooks within a few seconds. 132 of the `/api/webhooks/resend` calls failed (`[wh] [resend] unhandled: Error`), leaving 58 contacts stuck at "Sent". For at least five minutes afterwards, any request that needed a new database connection failed too, for example `/admin/waitlist`:

```
Failed query: select email, status, source, requested_at, invitation_sent_at from private.list_waitlist()
[cause]: (EMAXCONN) max client connections reached, limit: 200
```

Pages served by an instance that already held a connection kept working, so the failure looked intermittent. The first run on 2026-11-04 hit the same error (first seen 2026-11-04 18:11 UTC), but nobody noticed.

## Root cause

Vercel freezes an idle function instance instead of stopping it, and a frozen instance can't run timers. postgres.js closed idle connections with an `idle_timeout` timer, so every instance that touched the database during the burst froze with its connection still open at the pooler. The Supavisor pooler caps **client** connections at 200 on this compute size (Postgres itself had 16 server connections). A burst of about 300 webhooks made Vercel start more than 200 instances, and their frozen connections filled the cap until Vercel reclaimed the instances, about 5 to 10 minutes later.

The first fix, `max: 1` per instance ([#161](https://github.com/seanoliver/sealed/pull/161)), did not help. The second volume run on 2026-11-09 still failed 146 webhooks and `/admin/waitlist` returned `EMAXCONN` four minutes later. The count that matters is frozen instances, not connections per instance. Vercel's guide says the same: capping the pool at 1 "does not reduce total connections" (https://vercel.com/guides/connection-pooling-with-functions).

## Reproduction

Send about 300 address requests to `@resend.dev` addresses from the test book through the dashboard. Within a minute, Vercel runtime errors show `EMAXCONN` on `/api/webhooks/resend`, and a fresh load of `/admin/waitlist` fails.

## Fix

`src/lib/db/admin.ts` uses `pg`'s `Pool` (through `drizzle-orm/node-postgres`) registered with `attachDatabasePool` from `@vercel/functions`. That hook keeps an instance alive until its idle connections close, so an instance no longer freezes while holding a pooler slot. postgres.js has no equivalent hook, which is why the driver changed. The pool holds at most 2 connections and closes them after 1s idle. A request that can't get a connection within 15s fails; that covers both opening one and waiting for a busy one. 15s gives headroom over a typical hold, but under a burst, queued requests can still time out.

`attachDatabasePool` registers the keep-alive with whichever request is current when a connection is released. pg-pool's own `query()` releases from a socket callback, which belongs to the request that opened the connection, and drizzle's `transaction()` skips the release if `BEGIN` fails. So every query and transaction goes through `withClient`, which checks out a client, listens for its errors while it is out, and releases it in the caller's request. A client that hit a connection-level or FATAL error is destroyed instead of returned to the pool.

`poolConfig` turns the URL's `sslmode` into an explicit `ssl` option, because `pg` lets `sslmode` override it and reads `require` as full certificate verification. `require`, `prefer` and `allow` encrypt without a CA check, as postgres.js did.

Raw `execute` calls return `{ rows }` under `pg` instead of an array, and `pg` errors carry `constraint` instead of `constraint_name` (`src/lib/db/errors.ts`, `src/lib/log.ts`).

From #161, `withRls` and `adminTransaction` still set `statement_timeout` and `idle_in_transaction_session_timeout` to 10s for each transaction, and a lint rule bans calling `dbAdmin.transaction` directly. `approve-race.test.ts` and the concurrent-edit helper in `src/lib/agent/write.test.ts` use their own pools.

## Verification

Volume run on `35658a1`, 2026-11-09 at 7:28pm UTC: 294 emails to the 254 test contacts. `/admin/waitlist` loaded at 14, 37 and 62 seconds after the send, and no other route logged an error. 88 webhooks returned 500 between 7:28:50pm and 7:28:52pm UTC. The webhook route logs only `Error`, so their cause isn't recorded; `EMAXCONN` is the likely one. Resend retried them, and every row reached a final status within about 20 seconds of the send. The two earlier runs that day failed 132 and 146 webhooks, left 58 and 69 rows at "Sent", and kept new connections failing for 4 to 7 minutes.

Volume run on `89a9041`, after #170 (retry a delivery webhook that arrives before its send is recorded), 2026-11-10 at 6:02am UTC: 290 emails to the 250 load-test contacts. `/admin/waitlist` loaded at 13, 40, 65 and 89 seconds after the send. Vercel logged 74 webhook 500s, the last at 6:02:43am UTC, still only as `Error`. Resend retried them, and every row reached a final status within 20 seconds.

## Recurrence guardrail

`src/lib/db/admin-pool.test.ts` fails if the keep-alive goes to the wrong request, if a connection killed mid-transaction crashes the process or breaks the pool, if the idle-client error listener goes, or if the `sslmode` mapping or pool settings change. `src/lib/db/tx-limits.test.ts` covers the transaction limits, and `src/lib/db/admin-lint.test.ts` covers the lint rule. The volume run in #80 is the end-to-end check: re-run it after any change to the database client, the driver, or the webhook route.

## Follow-ups

Tracked in [#163](https://github.com/seanoliver/sealed/issues/163) (pooler fix follow-ups) and [#165](https://github.com/seanoliver/sealed/issues/165) (pg pool follow-ups). The 2-second window of webhook 500s may mean a burst still briefly reaches the pooler cap. Logging the webhook error code (in #163) would confirm it, and #165 tracks measuring the peak and shortening the idle timeout.
