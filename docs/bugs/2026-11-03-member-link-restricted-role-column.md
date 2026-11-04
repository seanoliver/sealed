# Invited members land on onboarding in production

**Date:** 2026-11-03
**Status:** Fixed
**Severity:** Important
**Last verified:** production on 2026-11-03 (stand-in member linked and saw the shared book)
**Related:** #143 (share the address book, sign emails as both owners), [book-members runbook](../runbooks/book-members.md), [restricted role investigation](../investigations/2026-07-12-restricted-db-role-for-production.md)

## Symptom

After #143 deployed, a confirmed user with a pending `book_members` invite signed in to production and landed on `/onboarding`. The membership row stayed unlinked (`user_id` null). Every local test, pgTAP test and CI run had passed.

## Root cause

`linkPendingMembership` (`src/lib/queries/books.ts`) reads `auth.users.email_confirmed_at` through `dbAdmin`. Production's `dbAdmin` connects as the restricted `app_server` role, which was granted only `select (id, email)` on `auth.users`. The query raised a permission error, the function's catch logged it and returned false, and `getOwnBook` treated the user as having no book. Local and CI connect as `postgres`, which can read every column, so nothing caught it before production.

## Reproduction

As `app_server` in production, before the grant: `select email_confirmed_at from auth.users limit 1` raises `permission denied for table users`. Sign in as an invited, confirmed user: redirect to `/onboarding`.

## Fix

- Production: `grant select (email_confirmed_at) on auth.users to app_server` (applied 2026-11-03 via the Management API).
- Repo: `supabase/migrations/20261103120100_app_server_confirmed_email.sql` grants it whenever the role exists; `docs/SECURITY.md` role snippet now lists the column.

## Verification

Re-ran the stand-in member sign-in against production: it linked, landed on `/dashboard`, showed the shared book's contacts, and Settings showed the shared-book notice.

## Recurrence guardrail

`src/lib/db/auth-users-columns.test.ts` scans app source for `auth.users <alias>` and fails when SQL reads a column outside the production grant. Verified it fails on this exact bug when the column is removed from the allowed list.

## Follow-ups

Running the integration suite as `app_server` in CI would catch the wider class (any table or column the role lacks), not only `auth.users` columns.
