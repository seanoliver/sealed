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

`src/lib/db/admin.ts` created one postgres.js client per function instance with `max: 10`. The Supavisor pooler caps **client** connections at 200 (Postgres itself had 16 server connections at the time). The burst spread across enough Vercel instances that 10 connections per instance passed 200. A suspended instance can't run its `idle_timeout` timer, so its connections stay open at the pooler until the instance is reclaimed. That's why the failure outlasted the burst.

## Reproduction

Send about 300 address requests to `@resend.dev` addresses from the test book through the dashboard. Within a minute, Vercel runtime errors show `EMAXCONN` on `/api/webhooks/resend`, and a fresh load of `/admin/waitlist` fails.

## Fix

`max: 1` on Vercel (`process.env.VERCEL`) in `src/lib/db/admin.ts`, so each instance holds at most one pooler connection. Local dev and tests keep 10, because `approve-race.test.ts` needs two concurrent transactions. No code path nests a `dbAdmin` query inside a `withRls` transaction (checked 2026-11-09), so one connection per instance can't deadlock a request against itself.

## Verification

Pending: deploy, then re-run the volume test (re-send to the 254 test contacts) and confirm that every row reaches a terminal status and that Vercel shows no `EMAXCONN`.

## Recurrence guardrail

The volume run in #80 is the check for this. Re-run it after any change to the database client or the webhook route.

## Follow-ups

- If `max: 1` is not enough (too many instances), move to `pg` with `attachDatabasePool` from `@vercel/functions`, which keeps the instance alive long enough to close idle connections. postgres.js isn't supported by that helper.
- Resend retries failed webhooks with backoff, so the stuck rows should recover on a retry. Confirm this after the re-run.
