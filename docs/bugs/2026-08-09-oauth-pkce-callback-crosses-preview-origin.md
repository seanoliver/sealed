# OAuth PKCE callback crosses the preview origin

**Date:** 2026-08-09
**Status:** Fixed
**Severity:** Important
**Last verified:** `156da36` on 2026-08-09
**Related:** [PR #9](https://github.com/seanoliver/address-book/pull/9), [Supabase SSR auth investigation](../investigations/2026-07-11-supabase-ssr-auth-on-next-16.md)

## Symptom

Google sign-in started on a Vercel preview completed at the stable staging domain and returned the user to `/login?error=1`. The Google authorization itself succeeded; `exchangeCodeForSession` failed at the application callback.

## Root cause

The Google server action in `src/app/login/page.tsx` built its `redirectTo` from canonical `APP_URL`. Supabase's PKCE flow had written the verifier cookie on the preview origin where sign-in began, but Google returned through `/auth/confirm` on stable staging. Cookies are origin-bound, so `src/app/auth/confirm/route.ts` could not supply the preview's verifier while exchanging the code.

`APP_URL` is appropriate for canonical links in email and public pages. It is not the OAuth return origin for a request that may begin on a Vercel preview.

## Reproduction

The deterministic reproduction uses two local hostnames for the same server:

```bash
CI=1 pnpm exec playwright test e2e/oauth-origin.spec.ts --project=chromium
```

Before the fix, sign-in began at `http://127.0.0.1:3000`, while the Supabase authorize request contained `redirect_to=http://localhost:3000/auth/confirm`. The test failed with expected origin `127.0.0.1` and received origin `localhost`.

## Fix

`src/lib/request-origin.ts` now derives the initiating origin from request headers only when the `Origin` host agrees with `x-forwarded-host`/`host`; otherwise it falls back to `APP_URL`. The Google action uses `currentRequestOrigin()` for `/auth/confirm`.

Magic-link and public-link generation still use canonical `APP_URL`; they do not depend on an OAuth PKCE verifier cookie.

## Verification

- `e2e/oauth-origin.spec.ts` failed before the change and passed afterward.
- The full PR #9 CI suite passed, including Playwright.
- Manual Google sign-in on the Vercel PR preview reached the authenticated application successfully.

## Recurrence guardrail

Keep `e2e/oauth-origin.spec.ts` in the E2E suite. Any auth-page refactor, including moving server actions between files, must preserve `currentRequestOrigin()` for OAuth redirects. While hosted staging existed (until 2026-10-13), Supabase staging also had to retain its preview-domain redirect wildcard; restore it if staging and PR previews come back.

## Follow-ups

When the editorial auth PR is rebased onto main, resolve its auth-action implementation in favor of `src/lib/request-origin.ts`; do not reintroduce `APP_URL` as the Google OAuth callback origin.
