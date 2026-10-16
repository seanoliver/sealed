# Run the beta waitlist

**Status:** Current
**Last verified:** not yet verified in production
**Owner:** Maintainers
**Related:** [#30](https://github.com/seanoliver/sealed/issues/30), [Security model](../SECURITY.md#invite-only-sign-up), [Environments](../ENVIRONMENTS.md#invite-only-sign-up)

## Purpose

Keep sign-up invite-only in production, and approve people from the waitlist.

## Prerequisites

- The `*_waitlist.sql` migration is applied to production (the deploy workflow does this on merge).
- `ADMIN_EMAILS` is set on the `sealed` Vercel project (Production target) and includes your email.
- `SUPABASE_SECRET_KEY` is set on the same target (Supabase dashboard, **Project Settings → API Keys → Secret keys**). Without it, approving fails with "Missing required environment variable: SUPABASE_SECRET_KEY" and changes nothing.
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

Open <https://sealed.page/admin/waitlist>. **Approve** marks an email approved and sends the "You're invited to Sealed" email with a sign-in link. The link expires after the project's OTP lifetime; an expired link lands on the entry page, where the person enters their email to get a new one. **Send invitation** approves an email that has not asked yet. An approved email whose invitation failed shows **Resend invitation**.

## Verification

- Request access at sealed.page with an email that is not approved. The page says "Your request is in", no email arrives, and the email appears under **Waiting**.
- Approve it. The invitation arrives, and its link signs in and creates the account. Requesting access again also sends a working sign-in link.

## Failure recovery

### Every new sign-up fails with a server error

The hook is enabled but the function is missing or not executable by `supabase_auth_admin`. Disable the hook (same PATCH with `"hook_before_user_created_enabled": false`), check that the migration applied, then enable it again.

### Approved, but "the invitation email failed"

Resend rejected or could not be reached. Check `EMAIL_FROM` and `RESEND_API_KEY`, then use **Resend invitation**.
