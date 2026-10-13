# Promote local changes through staging and production

**Status:** Stale — staging is verified; production remains unverified until its first end-to-end workflow release
**Last verified:** `156da36` on 2026-08-09 in staging
**Owner:** Maintainers
**Related:** [Environment topology](../ENVIRONMENTS.md), [PR #9](https://github.com/seanoliver/sealed/pull/9), [Vercel environment deletion incident](../bugs/2026-08-09-vercel-env-target-removal-deletes-shared-record.md)

## Purpose

Promote one verified commit from local/PR testing to shared staging and then to production without crossing data, auth, or credential boundaries.

## Prerequisites

- Use the environment assignments in `docs/ENVIRONMENTS.md`; never substitute one environment's Supabase project or data into another.
- PR CI and the staging Vercel preview must be green.
- GitHub `Staging` contains `STAGING_DATABASE_URL`; GitHub `Production` contains `PRODUCTION_DATABASE_URL` and requires approval.
- Both migration URLs must use Supabase's IPv4 **session pooler** on port 5432 with `sslmode=require`. GitHub-hosted runners cannot reach the projects' IPv6-only direct database endpoints, and the transaction pooler on port 6543 is incompatible with the migration CLI's prepared statements.
- Vercel Production has the complete variable set listed in `docs/ENVIRONMENTS.md` and remains disconnected from Git.
- Migrations are backward-compatible with the currently deployed application. Production has no automatic schema rollback.
- Do not run `supabase config push` from the localhost-oriented `supabase/config.toml`; hosted Auth URL/provider configuration is managed separately.

## Procedure

1. Verify the PR locally and in its staging-backed Vercel preview. For OAuth, confirm the callback stays on the preview where sign-in began.
2. Merge the PR to `main` only after CI and the preview pass.
3. Watch main CI:

   ```bash
   gh run list --workflow ci.yml --branch main --limit 5
   gh run watch <run-id> --exit-status
   ```

4. Main CI success triggers `.github/workflows/deploy-staging.yml`. Record that staging workflow's run ID, watch it, and require a successful `supabase db push`:

   ```bash
   gh run list --workflow deploy-staging.yml --limit 5
   gh run watch <staging-run-id> --exit-status
   ```

5. Read the tested SHA from the successful staging workflow itself; do not infer it from a local `origin/main`, which may be stale or may already have advanced:

   ```bash
   STAGING_SHA=$(gh run view <staging-run-id> \
     --json headSha,conclusion \
     --jq 'select(.conclusion == "success") | .headSha')
   test -n "$STAGING_SHA"
   ```

6. Confirm the stable staging Vercel deployment reports the same commit SHA, then smoke-test `https://sealed-staging.vercel.app`: login, callback, onboarding, an authenticated owner action, and any changed recipient flow. Application-generated address-request email remains dry-run in staging.
7. Dispatch the protected production workflow with `STAGING_SHA` or a release tag resolving to that exact commit:

   ```bash
   gh workflow run deploy-production.yml -f ref="$STAGING_SHA"
   ```

8. Approve the GitHub Production environment deployment after checking the ref and staging evidence. The workflow applies migrations first and then uploads that checkout for a remote Vercel production build. The build must remain remote: sensitive Vercel variables are intentionally unavailable to `vercel pull` and therefore cannot support a local/prebuilt CI build.
9. Watch the workflow to completion and run non-destructive production smoke checks: homepage, login initiation/callback, dashboard access, and public form rendering. Do not create or inspect real contact data merely for a smoke test.
10. After the first deployment using a rotated runtime database role, confirm the active deployment connects successfully before disabling the superseded login credential.

## Verification

A promotion is complete only when all applicable signals pass:

```bash
gh run list --branch main --limit 10
curl -fsS -o /dev/null -w '%{http_code}\n' https://sealed-staging.vercel.app/login
```

For production, also verify:

- the workflow's migration and Vercel jobs used the same requested ref,
- Google OAuth returns through `/auth/confirm`,
- Vercel logs show no missing-environment or database-authentication errors,
- Resend and Turnstile credentials are present by name in Vercel without revealing their values.

## Failure recovery

### Staging migration reports an IPv6 network error

The secret contains a direct Supabase URL. Rotate the staging database-owner password, construct the project's session-pooler URL (`postgres.<project-ref>` on port 5432), verify it connects as `postgres`, replace `STAGING_DATABASE_URL`, and rerun only the failed workflow. Never print the URL or password in logs.

### Migration reports `prepared statement "lrupsc_1_0" already exists`

The migration used Supabase's transaction pooler on port 6543. That pooler can assign a backend carrying another CLI client's named prepared statement, so retrying does not reliably recover. Use the IPv4 session-pooler endpoint on port 5432 instead. The deployment workflows normalize legacy 6543 pooler secrets to 5432 and reject direct or otherwise unexpected endpoints before invoking the CLI.

### Migration fails on SQL

Do not force a deployment or edit migration history. Diagnose against a disposable/local database, then add a corrective forward migration. Staging Vercel deploys independently through Git, so backward compatibility is required while the schema failure is corrected.

### Production migration succeeds but deployment fails

Leave the previous production deployment serving traffic. Because migrations must be expand/migrate/contract compatible, repair the build and rerun the same ref or a forward-fix ref; do not attempt an automatic database rollback. If a CI build reports an invalid empty environment value after `vercel pull`, do not downgrade secret types: sensitive values are write-only outside Vercel. Keep the workflow's build remote so Vercel can inject them server-side.

### A Vercel variable disappears while changing targets

Stop before redeploying. Follow the provider-rotation recovery in `docs/bugs/2026-08-09-vercel-env-target-removal-deletes-shared-record.md`, restore the complete Production set, and verify names with `vercel env ls`.

## References

- `.github/workflows/ci.yml`
- `.github/workflows/deploy-staging.yml`
- `.github/workflows/deploy-production.yml`
- `docs/ENVIRONMENTS.md`
- Supabase database connection guidance: <https://supabase.com/docs/guides/database/connecting-to-postgres>
- GitHub environments: <https://docs.github.com/actions/deployment/targeting-different-environments/using-environments-for-deployment>
