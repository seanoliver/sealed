# Vercel environment target removal deletes the shared variable record

**Date:** 2026-08-09
**Status:** Mitigated
**Severity:** Important
**Last verified:** `156da36` on 2026-08-09
**Related:** [PR #9](https://github.com/seanoliver/address-book/pull/9), [Environment topology](../ENVIRONMENTS.md), [Environment promotion runbook](../runbooks/promote-environments.md)

## Symptom

While removing Preview-targeted variables from the production Vercel project with Vercel CLI 49.1.2, variables that also served Production disappeared from the project configuration entirely. The running production deployment stayed healthy because Vercel deployments retain their build-time environment snapshot, but a new production deployment would have omitted database, Resend, and Turnstile credentials.

## Root cause

The attempted target-specific `vercel env rm` operation removed the underlying environment-variable record rather than editing only its target list. Treating a multi-target record as if each target were an independent secret made the cleanup destructive.

This is an observed CLI/platform behavior, not an application-code defect. Re-verify it against current Vercel behavior before assuming it remains unchanged.

## Reproduction

The incident involved variables shared across Production and Preview in one Vercel project, followed by target-oriented removal through the CLI. Do not reproduce this against a project containing live credentials.

A safe inspection command is:

```bash
vercel env ls --scope <team>
```

The incident was detected because this listing showed only `APP_URL` and subsequently restored Supabase values where the complete production set had existed before.

## Fix

The production project was disconnected from Git, eliminating its need for Preview-targeted variables. Production values were recreated from their authoritative providers or rotated:

- Supabase runtime and migration database credentials,
- Resend sending key and webhook signing secret,
- Cloudflare Turnstile site and secret keys,
- environment identity and canonical URLs.

No old secret was copied from staging or local.

## Verification

- `vercel env ls` showed the complete required Production variable names.
- Replacement runtime and migration database URLs connected as their expected roles.
- The existing production deployment remained available throughout recovery.
- GitHub's protected Production environment contains `PRODUCTION_DATABASE_URL`.

## Recurrence guardrail

- Keep the production Vercel project disconnected from Git; previews belong only to the staging project.
- Do not use `vercel env rm <name> <target>` to edit a live multi-target variable record without a recoverable source value.
- Prefer separate records/projects, or use the dashboard to review the final target set.
- Immediately run `vercel env ls` after any target change and before triggering a deployment.
- Never rely on an existing deployment snapshot as the backup for a secret; provider-side rotation is the recovery path.

## Follow-ups

After the first successful workflow-driven production deployment, retire the old `app_server` login credential only after confirming the deployment uses the rotated runtime role described in `docs/ENVIRONMENTS.md`.
