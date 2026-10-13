# Ship a change to production

**Status:** Current — staging retired on 2026-10-13; every push to `main` migrates and deploys production automatically
**Last verified:** not yet verified end to end on the new flow
**Owner:** Maintainers
**Related:** [Environment topology](../ENVIRONMENTS.md), [PR #9](https://github.com/seanoliver/sealed/pull/9) (the original staging flow), [Vercel environment deletion incident](../bugs/2026-08-09-vercel-env-target-removal-deletes-shared-record.md)

## Purpose

Get a merged change live on sealed.page, with any database migration applied immediately before the code that needs it.

## Prerequisites

- GitHub `Production` contains `PRODUCTION_DATABASE_URL` and `VERCEL_TOKEN`, plus the `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` variables, and allows only `main`.
- The migration URL uses Supabase's IPv4 **session pooler** on port 5432 with `sslmode=require`. GitHub-hosted runners cannot reach the project's IPv6-only direct endpoint, and the transaction pooler on port 6543 is incompatible with the migration CLI's prepared statements.
- The `sealed` Vercel project stays disconnected from Git, and every production variable is scoped to the Production target.
- Migrations are backward-compatible with the code that is live when they run, and start with `set local lock_timeout = '5s';`. Production has no automatic schema rollback.
- Do not run `supabase config push` from the localhost-oriented `supabase/config.toml`; hosted Auth configuration is managed separately.

## Procedure

1. Verify the PR locally and in CI. `main` requires a PR that is up to date with `main` and has passing checks.
2. Merge the PR.
3. CI runs on `main`. When it passes, **Deploy production** runs on its own: it checks out the head of `main`, migrates, checks production's migrations against the repository, and deploys. If several PRs merge close together, an earlier run may already deploy a later commit. Watch it if the PR has a migration:

   ```bash
   gh run list --workflow deploy-production.yml --limit 1
   gh run watch <run-id> --exit-status
   ```

4. Confirm the production deployment is Ready and reports the merge commit, then run non-destructive smoke checks: homepage, login initiation and callback, dashboard access, public form rendering, and any changed flow. Do not create or inspect real contact data just for a smoke test.

To redeploy the head of `main` without a new commit, dispatch the workflow: <https://github.com/seanoliver/sealed/actions/workflows/deploy-production.yml> → **Run workflow**, or `gh workflow run deploy-production.yml`.

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

The migration used the transaction pooler on port 6543. The workflow normalizes 6543 URLs to 5432 and rejects direct or unexpected endpoints; if this still appears, check the secret's host and port.

### Migration fails on SQL or times out waiting for a lock

A lock timeout means a long query or transaction held the table; rerun the workflow once traffic is quiet. Otherwise the deploy does not happen, so the previous code keeps running against the unchanged schema (each migration file applies atomically unless it contains a statement that cannot run in a transaction, such as `create index concurrently`). Fix forward with a new PR that corrects the migration. If an earlier file in the same push applied, add a corrective migration rather than editing the applied file.

### `db push` reports "Remote migration versions not found in local migrations directory"

Production has a migration version the repository lacks, usually one applied by hand. The deploy does not happen. Restore the missing file in a PR, or mark the version reverted with `supabase migration repair --status reverted <version> --db-url <session-pooler URL>` after undoing its schema change. Do not delete rows from `supabase_migrations.schema_migrations` directly.

### The migration check fails

This is a backstop: `db push` normally stops on the cases above first.

Production's migration versions differ from the repository's, and the deploy does not happen. "Not applied" means `db push` skipped a version, usually because two migrations share one; rename the newer one with `supabase migration new`. "Applied to production but not in the repository" means a migration was run by hand or the repository lost one; restore the file or mark the version reverted with `supabase migration repair --status reverted <version> --db-url <session-pooler URL>`. Do not delete rows from `supabase_migrations.schema_migrations` directly.

### Migration succeeds but the Vercel deploy fails

The previous deployment keeps serving traffic against the new schema, which is safe because migrations are backward-compatible. Fix the build and push again, or dispatch the workflow to retry. Keep the build remote: sensitive Vercel variables are write-only outside Vercel.

### A Vercel variable disappears while changing targets

Stop before redeploying. Follow the recovery in `docs/bugs/2026-08-09-vercel-env-target-removal-deletes-shared-record.md`, restore the complete Production set, and verify names with `vercel env ls`.

## References

- `.github/workflows/ci.yml`
- `.github/workflows/deploy-production.yml`
- `scripts/ci/migration-drift.sh` (tested in `scripts/ci/migration-drift.test.ts`)
- `scripts/ci/deploy-workflow.test.ts` (trigger, gate and step order of the deploy workflow)
- `scripts/ci/migrations.test.ts` (lock timeout on new migrations)
- `docs/ENVIRONMENTS.md`
- Supabase database connection guidance: <https://supabase.com/docs/guides/database/connecting-to-postgres>
