# Raw update tokens in platform request logs

**Date:** 2026-10-14
**Status:** Mitigated
**Severity:** Minor
**Last verified:** branch `fix/33-tokens-in-logs` on 2026-10-14
**Related:** GitHub issue #33, `docs/SECURITY.md` (Token design)

## Symptom

`vercel logs` on production showed full `/u/<token>` request paths, so live update tokens sat in platform logs. The code comments claimed "the raw token never reaches logs", which held only for application logging.

## Root cause

The token was a path segment for the whole recipient flow, not just the emailed link. The page rendered at `/u/<token>`, its RSC fetches went to that path, and the server action form posted back to it. So the token was logged on every view, every refresh, and on the submit itself. Vercel records request paths regardless of what the app logs. The action also bound the token as an argument, which round-trips through the client.

## Reproduction

1. Mint a token (`EMAIL_DRY_RUN=1`, or `seedUpdateToken` in e2e).
2. Open `/u/<token>` and submit the form.
3. Watch requests (Playwright `page.on("request")` or browser devtools): the page load and the action POST both carry the token in the URL.

## Fix

Exchange on first visit (option 3 in #33). The emailed link format is unchanged, so links already sent keep working.

- `src/app/u/[token]/route.ts`: a GET route handler replaces the page. It does no DB work. It puts a shape-valid token in an HttpOnly, `SameSite=Lax`, `Path=/u`, one-day cookie named by a hash of the token (`ref`), and 303-redirects to `/u/edit?ref=<ref>`, with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. A malformed path redirects with no ref. One cookie per link means two links open in one browser each save to their own contact; a single shared cookie sent one tab's form to the other tab's contact (caught in review).
- `src/app/u/edit/page.tsx` and `actions.ts` (moved from `[token]/`): read the cookie for their `ref` and check the token hashes to it. The action is bound to the non-secret ref, never the token, and deletes the cookie after any apply. A missing cookie shows a "Page timed out" notice and keeps typed values.
- `src/app/u/update-token-cookie.ts`: ref hashing, cookie naming and options, and `readUpdateToken`.

`/u/edit` is a static segment, so it wins over `[token]`, and it stays under the proxy matcher's `u/` exclusion (no session work).

## Verification

- `src/app/u/[token]/route.test.ts`: redirect target and ref, cookie attributes and one-day lifetime, Secure only over https, query string dropped, malformed path gets no ref or cookie, and `readUpdateToken` ignoring another link's cookie or a mismatched token.
- `e2e/token-update.spec.ts`: the full recipient flow records every request URL; exactly one (`/u/<token>`) contains the token, and the submit goes to `/u/edit`. Failed before the fix, passes after.
- Not yet verified with `vercel logs` on production (acceptance criterion in #33); do that after deploy.

## Recurrence guardrail

The e2e assertion that only one request URL in the whole flow contains the token. Any new route or action that puts the token back in a URL fails it.

## Follow-ups

The first request still logs the token once. Option 2 in #33 (link to `/u#<token>`) would remove that too, but changes the emailed link format and needs an ADR.
