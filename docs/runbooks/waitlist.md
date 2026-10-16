# Run the beta waitlist

**Status:** Current
**Last verified:** production on 2026-10-16 (gate rejects unapproved sign-ups; an approval sent an invitation whose link signed in)
**Owner:** Maintainers
**Related:** [#30](https://github.com/seanoliver/sealed/issues/30), [Security model](../SECURITY.md#invite-only-sign-up), [Environments](../ENVIRONMENTS.md#invite-only-sign-up)

## Purpose

Keep sign-up invite-only in production, and approve people from the waitlist.

## Prerequisites

- The `*_waitlist.sql` migration is applied to production (the deploy workflow does this on merge).
- `ADMIN_EMAILS` is set on the `sealed` Vercel project (Production target) and includes your email.
- `SUPABASE_SECRET_KEY` is set on the same target (Supabase dashboard, **Project Settings → API Keys → Secret keys**, or `GET /v1/projects/ivwrvilpjhqhmlzwgyot/api-keys?reveal=true`, the entry with `"type": "secret"`). Do not copy it from `supabase projects api-keys`: the CLI masks secret keys, and a masked key makes every approval fail with `generateLink failed: AuthApiError 401` ([bug](../bugs/2026-10-16-supabase-cli-masked-secret-key.md)). Before saving, run `read -rs KEY`, paste the key (nothing is echoed), and check it returns 200: `curl -s -o /dev/null -w '%{http_code}' "https://ivwrvilpjhqhmlzwgyot.supabase.co/auth/v1/admin/users?per_page=1" -H "apikey: $KEY"`, then `unset KEY`. Without the variable, approving fails and changes nothing.
- A Supabase Management API token with access to the production project.

## Enable the gate (once)

Enable the hook as soon as the deploy run's **Apply committed migrations** step succeeds, before the new build goes live. Until the hook is on, anyone can create an account. If the hook points at a function that does not exist yet, every new sign-up fails instead.

Keep **Confirm email** on in hosted Auth (`mailer_autoconfirm = false`); the password-stripping trigger relies on it.

```bash
curl -fsS -X PATCH "https://api.supabase.com/v1/projects/ivwrvilpjhqhmlzwgyot/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"hook_before_user_created_enabled": true,
       "hook_before_user_created_uri": "pg-functions://postgres/private/before_user_created_hook"}'
```

## Approve people

Open <https://sealed.page/admin/waitlist>. **Approve** marks an email approved and sends the "You're invited to Sealed" email with a sign-in link. The link expires after the project's OTP lifetime; an expired link lands on the entry page, where the person enters their email to get a new one. **Send invitation** approves an email that has not asked yet. Every approved row has **Resend invitation**, which emails a fresh link; the earlier link may stop working.

## Verification

- Request access at sealed.page with an email that is not approved. The page says "Your request is in", no email arrives, and the email appears under **Waiting**.
- Approve it. The invitation arrives, and its link signs in and creates the account. Requesting access again also sends a working sign-in link.

## Failure recovery

### Every new sign-up fails with a server error

The hook is enabled but the function is missing or not executable by `supabase_auth_admin`. Disable the hook (same PATCH with `"hook_before_user_created_enabled": false`), check that the migration applied, then enable it again.

### Approved, but "the invitation email failed"

Check the production function logs for a `[wl] [approveEmail]` or `[em] [sendNotification]` line.

- `[wl] [approveEmail] generateLink failed: AuthApiError 401`: `SUPABASE_SECRET_KEY` is invalid, often a masked copy ([bug](../bugs/2026-10-16-supabase-cli-masked-secret-key.md)). Re-check it with the curl in Prerequisites, replace it, and redeploy.
- Any other `generateLink failed`: Supabase Auth rejected the request or could not be reached (the status is in the line, for example 429 or 5xx). Retry later.
- `[em] [sendNotification] ...`: Resend rejected the email or could not be reached, or `EMAIL_FROM` is not set. Check `EMAIL_FROM` and `RESEND_API_KEY`.

Then use **Resend invitation**.
