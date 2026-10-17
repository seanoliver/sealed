# A direct sign-up could choose an owner's display name

**Date:** 2026-10-17
**Status:** Fixed
**Severity:** Important
**Last verified:** PR #75 (harden the waitlist without UI changes) on 2026-10-17
**Related:** #70 (hardening with no UI changes), #67 (waitlist follow-ups from #52), [SECURITY.md](../SECURITY.md)

## Symptom

No incident was observed. Review of the waitlist found that anyone could set the display name an approved person's recipients would see, before that person signed in.

## Root cause

`private.handle_new_user` copied `raw_user_meta_data.full_name` (or `name`) into `profiles.display_name` for every new user. User metadata comes from the client: Supabase Auth `signUp` and `signInWithOtp` accept it as `options.data` with the public anon key. The before-user-created hook lets any approved email through, so a stranger who knew an approved address could create that user first with a name of their choosing.

The onboarding page had the same trust problem: it pre-filled the name from `user_metadata` claims whenever the profile name was empty.

## Reproduction

With an approved email that has no account yet:

```js
await supabase.auth.signUp({
  email: "approved@example.com",
  password: "unused",
  options: { data: { full_name: "Chosen Name" } },
});
```

Before the fix, `profiles.display_name` for that user was `Chosen Name`, and onboarding pre-filled it.

## Fix

- `supabase/migrations/20261017120000_waitlist_hardening.sql`: `handle_new_user` reads metadata only when `raw_app_meta_data.provider` is `google`. Auth sets that field and clients cannot. Every other provider starts with an empty name.
- `src/lib/onboarding.ts`: `googleDisplayName` reads the name from a linked Google identity's `identity_data` through `auth.getUser()`, never from `user_metadata`. Invitees are created as email users by `generateLink`, so a later Google sign-in still pre-fills their Google name.

## Verification

- pgTAP in `supabase/tests/database/02_functions.sql`: email, missing-provider and Google users, the `name` fallback, `full_name` preference and the 200-character cap.
- `src/lib/onboarding.test.ts` and `src/app/onboarding/page.test.ts`: the page pre-fills from a Google identity, ignores metadata without one, and keeps a saved name.

## Recurrence guardrail

The page test fails if onboarding reads `user_metadata` again, and the pgTAP test fails if a later migration rewrites `handle_new_user` to trust metadata for every provider. Treat `raw_user_meta_data` and `user_metadata` as client input anywhere they are read.

## Follow-ups

Profiles created before this migration are not cleared. Tracked in the #75 follow-ups issue.
