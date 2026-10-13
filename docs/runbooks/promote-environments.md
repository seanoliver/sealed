# Ship a change to production

**Status:** Current — staging retired on 2026-10-13; `main` deploys to production through Vercel's Git integration
**Last verified:** not yet verified end to end on the new flow
**Owner:** Maintainers
**Related:** [Environment topology](../ENVIRONMENTS.md), [PR #9](https://github.com/seanoliver/sealed/pull/9) (the original staging flow), [Vercel environment deletion incident](../bugs/2026-08-09-vercel-env-target-removal-deletes-shared-record.md)

## Purpose

Get a merged change live on sealed.page, applying any database migration first so the new code never runs against an old schema.

## Prerequisites

- The `sealed` Vercel project is Git-connected and builds only `main` (`vercel.json` `git.deploymentEnabled` plus the project's Ignored Build Step). There are no PR previews.
- GitHub `Production` contains `PRODUCTION_DATABASE_URL`, restricted to `main` and `v*` by the environment's branch policy.
- The migration URL uses Supabase's IPv4 **session pooler** on port 5432 with `sslmode=require`. GitHub-hosted runners cannot reach the project's IPv6-only direct endpoint, and the transaction pooler on port 6543 is incompatible with the migration CLI's prepared statements.
- Migrations are backward-compatible with the code on `main`. Production has no automatic schema rollback.
- Do not run `supabase config push` from the localhost-oriented `supabase/config.toml`; hosted Auth configuration is managed separately.

## Procedure

1. Verify the PR locally and in CI. `main` requires a PR with passing checks.
2. **If the PR adds a migration**, apply it before merging. Dispatch **Migrate production** against the PR branch and wait for it to succeed:

   ```bash
   gh workflow run migrate-production.yml -f ref=<pr-branch>
   gh run list --workflow migrate-production.yml --limit 1
   gh run watch <run-id> --exit-status
   ```

   Or from the browser: <https://github.com/seanoliver/sealed/actions/workflows/migrate-production.yml> → **Run workflow**.
3. Merge the PR. Vercel builds and deploys the merge commit to production.
4. Confirm the production deployment is Ready and reports the merge commit, then run non-destructive smoke checks: homepage, login initiation and callback, dashboard access, public form rendering, and any changed flow. Do not create or inspect real contact data just for a smoke test.

## Verification

```bash
vercel ls sealed --prod --scope cabin-9
curl -fsS -o /dev/null -w '%{http_code}\n' https://sealed.page/login
```

Also check:

- Google OAuth returns through `/auth/confirm`,
- Vercel logs show no missing-environment or database-authentication errors.

## Failure recovery

### Migration reports an IPv6 network error

The secret contains a direct Supabase URL. Rotate the database-owner password, construct the project's session-pooler URL (`postgres.<project-ref>` on port 5432), verify it connects as `postgres`, replace `PRODUCTION_DATABASE_URL`, and rerun the workflow. Never print the URL or password in logs.

### Migration reports `prepared statement "lrupsc_1_0" already exists`

The migration used the transaction pooler on port 6543, which can hand the CLI a backend carrying another client's prepared statement. The workflow normalizes 6543 URLs to 5432 and rejects direct or unexpected endpoints; if this still appears, check the secret's host and port.

### Migration fails on SQL

Do not merge the PR. Diagnose against a local database, fix the migration on the branch (it was not applied), and rerun **Migrate production**. If part of a multi-file push applied, add a corrective forward migration rather than editing an applied file.

### A deploy fails after merge

The previous production deployment keeps serving traffic. Fix forward with a new PR, or promote an earlier deployment from the Vercel dashboard (Instant Rollback). A rollback does not undo migrations, which is why migrations must stay backward-compatible.

### A Vercel variable disappears while changing targets

Stop before redeploying. Follow the recovery in `docs/bugs/2026-08-09-vercel-env-target-removal-deletes-shared-record.md`, restore the complete Production set, and verify names with `vercel env ls`.

## References

- `.github/workflows/ci.yml`
- `.github/workflows/migrate-production.yml`
- `vercel.json`
- `docs/ENVIRONMENTS.md`
- Vercel Git configuration: <https://vercel.com/docs/project-configuration/git-configuration>
- Supabase database connection guidance: <https://supabase.com/docs/guides/database/connecting-to-postgres>
