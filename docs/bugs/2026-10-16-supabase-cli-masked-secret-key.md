# Production approvals failed because Vercel held a masked secret key

**Date:** 2026-10-16
**Status:** Fixed
**Severity:** Important
**Last verified:** `411b5c2` on 2026-10-16
**Related:** #52, #30, [Waitlist runbook](../runbooks/waitlist.md)

## Symptom

On `/admin/waitlist` in production, every Approve and Send invitation showed "…but the invitation email failed. Use Resend invitation to try again." The production function logs showed:

```
[wl] [approveEmail] generateLink failed: AuthApiError 401
```

The email was still marked approved, but no invitation went out.

## Root cause

`SUPABASE_SECRET_KEY` on the Vercel Production target was set from the output of `supabase projects api-keys --project-ref <ref> -o json`. That command masks new-style secret keys: it prints `sb_secret_`, five characters, then `·` dots, padded to the real key's length. Supabase Auth rejected the masked string with 401, so `auth.admin.generateLink` failed on every approval.

Nothing in the deploy checks that the key works. The smoke check only loads `/`, and approving is the only use of the key.

## Reproduction

```bash
supabase projects api-keys --project-ref <ref> -o json   # secret key ends in ·····
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://<ref>.supabase.co/auth/v1/admin/users?per_page=1" -H "apikey: <that value>"   # 401
```

## Fix

Replaced the Vercel value with the real key from the Management API, then redeployed production through the deploy workflow:

```bash
curl -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/<ref>/api-keys?reveal=true"
```

No code changed.

## Verification

- The revealed key returned 200 from `/auth/v1/admin/users?per_page=1`.
- After the redeploy, sending an invitation from `/admin/waitlist` showed "Invitation sent", and the emailed link signed the new user in.

## Recurrence guardrail

The waitlist runbook now says to take the key from the dashboard or the `?reveal=true` endpoint, and to test it against the Auth admin API before saving it. There is no automated check. A deploy step that calls the admin API with the stored key would need the key in GitHub as well, which widens where it lives.

## Follow-ups

Approving marks the row approved before the invitation is sent, so a failed send leaves an approved row with no invitation. "Resend invitation" handles that, and #67 tracks the related admin follow-ups.
