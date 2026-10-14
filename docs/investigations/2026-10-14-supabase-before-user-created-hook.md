# Supabase before-user-created hook as a waitlist gate

**Date:** 2026-10-14
**Status:** Current
**Prompted by:** Feature build (#30, invite-only beta)
**Last verified:** `supabase/auth` master and Supabase CLI 2.109.1 on 2026-10-14
**Related:** [#30](https://github.com/seanoliver/sealed/issues/30), [Waitlist runbook](../runbooks/waitlist.md), [Security model](../SECURITY.md#invite-only-sign-up)

## Question

Can one Supabase Auth hook both reject sign-ups from unapproved emails and record those emails on a waitlist, for magic links and Google OAuth alike? The public docs do not say which sign-up paths call the hook or whether writes made inside a Postgres hook survive a rejection.

## Key findings

1. **Every user-creating path calls the hook.** In `supabase/auth`, `triggerBeforeUserCreated` is called from `signup.go` (which magic link and OTP sign-ups go through), `external.go` (OAuth), `token_oidc.go`, `samlacs.go`, `web3.go`, `invite.go` and `anonymous.go`. Existing users never reach it: OAuth skips it when account linking finds an existing user, and OTP for an existing email does not sign up.
2. **Writes in a Postgres hook are kept when it rejects.** `checkTX` refuses to run hooks inside a transaction, so the hook is invoked outside the user-creation transaction. The Postgres dispatcher (`hookspgfunc.runPostgresHook`) runs the function in its own transaction and commits, then `hookserrors.Check` inspects the returned JSON. A rejection is a normal return value (`{"error": {...}}`), not an exception, so an `insert` in the function persists.
3. **The reject message reaches the app unchanged.** For OTP, `signInWithOtp` returns an error with the hook's `message` and `http_code` (observed locally: `{"code":403,"msg":"sealed_waitlisted"}`). For OAuth, `redirectErrors` redirects to the request's `redirect_to` (or the Site URL when it is unusable) with `error`, `error_code` and `error_description=<message>` in the query string and fragment.
4. **Google sign-ups carry `app_metadata.provider = "google"`** in the hook payload (`SignupParams.ToUserModel`).
5. **Local and hosted configuration differ.** Local: `[auth.hook.before_user_created]` in `supabase/config.toml`. Hosted: `hook_before_user_created_enabled` and `hook_before_user_created_uri` in the Management API auth config.

## How it works

- `supabase/migrations/*_waitlist.sql`: `private.waitlist` and `private.before_user_created_hook(jsonb)`, `SECURITY DEFINER`, executable only by `supabase_auth_admin` (which also needs `usage` on `private`).
- `src/app/auth/actions.ts` (`requestAccess`) treats the `sealed_waitlisted` error as success, so approved, existing and waitlisted emails get the same response.
- `src/app/auth/confirm/route.ts` and `src/app/page.tsx` turn `error_description=sealed_waitlisted` into the Google confirmation.

## Gotchas

- Enabling the hosted hook before the migration applies makes every new sign-up fail, because the function does not exist yet.
- The magic-link email template appends `&token_hash=…` to `RedirectTo`, so the confirmation URL must already carry a query string (`src/lib/auth-flow.ts`).
- An HTTP hook would also work, but it needs a signing secret and a reachable app URL from the Auth container in CI. The Postgres hook needs neither.

## Open questions

None.

## References

- `supabase/auth`: `internal/api/hooks.go` (`triggerBeforeUserCreated`, `checkTX`), `internal/api/external.go` (`redirectErrors`, `getExternalRedirectURL`), `internal/hooks/hookspgfunc/hookspgfunc.go`, `internal/hooks/hookserrors/hookserrors.go`, `internal/api/signup.go`
- <https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook>
- `supabase/tests/database/03_waitlist.sql`, `e2e/waitlist.spec.ts`
