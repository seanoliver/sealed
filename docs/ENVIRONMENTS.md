# Environments and promotion

Sealed runs in two environments, local and production. A hosted staging environment existed until 2026-10-13 and is retired (see [Retired staging](#retired-staging)). `APP_ENV` is the application-level environment selector; do not use `NODE_ENV` for this distinction because Vercel Preview deployments also run with `NODE_ENV=production`.

## Environment matrix

| Concern | Local | Production |
|---|---|---|
| Application | `http://localhost:3000` | `sealed` Vercel project, deployed from `main` |
| Supabase | CLI stack | `sealed` (`ivwrvilpjhqhmlzwgyot`) |
| Database data | Disposable local fixtures | Real owner/contact data |
| Email | Mailpit and dry-run logs | Resend production sender |
| Turnstile | Cloudflare test keys | Real production widget |
| Google OAuth | Dedicated local client | Dedicated production client |

The Vercel project belongs to the `cabin-9` team (`team_zbOQcoGZ8Edz3hYHUC0mHa3t`), and the Supabase project to the personal Supabase organization (Pro plan). Never copy production contact data into a local database.

## URL rules

`APP_URL` is the **canonical URL** used in outgoing email and public address-book links:

- Local: `http://localhost:3000`
- Production: the production domain

Production Supabase must allow only production callbacks.

## Local development

1. Start the local stack and application:

   ```bash
   pnpm supabase start
   cp .env.local.example .env.local
   # Fill NEXT_PUBLIC_SUPABASE_ANON_KEY from `supabase status -o env`.
   pnpm dev
   ```

2. Keep these local values:

   ```env
   APP_ENV=local
   APP_URL=http://localhost:3000
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
   EMAIL_DRY_RUN=1
   ```

3. Magic-link emails appear in Mailpit at <http://127.0.0.1:54324>.

### Local Google OAuth

Create a Google Web OAuth client with this exact authorized redirect URI:

```text
http://127.0.0.1:54321/auth/v1/callback
```

Configure `supabase/config.toml` locally:

```toml
[auth.external.google]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
redirect_uri = "http://127.0.0.1:54321/auth/v1/callback"
skip_nonce_check = false
```

Export the two credential variables before restarting Supabase. An ignored `.envrc` with `direnv allow` is supported for local development. Never commit them. Keep `skip_nonce_check = false`; the current Supabase Auth flow performs the nonce check.

## Retired staging

Until 2026-10-13 a hosted staging environment (`sealed-staging` Vercel project, `sealed-staging` Supabase project `fmjbjkcuyqopoubbylme`) received every merge and every PR preview, and production was released by hand after staging verification. With no real users yet, it was retired to match the simpler flow used by Sean's other projects. The Supabase project is paused, not deleted, and the Vercel project is disconnected from Git. Restore both before bringing staging back, and reintroduce a staging workflow and runbook steps. The GitHub `Staging` environment and its secret are deleted.

## Production

Every push to `main` deploys to production, with no manual step. After **CI** passes on `main`, `.github/workflows/deploy-production.yml`:

1. checks out the current head of `main`, which may be newer than the commit whose CI finished; the `main` ruleset only accepts PRs that are up to date and green, so every head has been tested,
2. applies committed migrations with `supabase db push`,
3. checks that production's migration versions match the repository's (`scripts/ci/migration-drift.sh`),
4. builds and deploys that commit on Vercel.

A migration therefore runs immediately before the code that needs it goes live, never ahead of review. The workflow can also be dispatched by hand to redeploy the head of `main`.

The `sealed` Vercel project is not connected to GitHub, so it has no PR previews and deploys only through this workflow. Production variables are scoped to the Production target.

The `Production` GitHub environment allows only `main` and has no required reviewers. GitHub does not support required reviewers on private repositories below Enterprise, and the repository has a single maintainer; this was a deliberate choice on 2026-10-13.

Required GitHub Production secret:

```text
PRODUCTION_DATABASE_URL
```

This migration URL connects as the Supabase database owner and is available only to the deploy job, which runs only on `main` (the `Production` environment's branch policy). It must use the IPv4 session pooler on port 5432 for GitHub-hosted runners; the transaction pooler on port 6543 can retain the CLI's prepared statements across clients and fail retries with `SQLSTATE 42P05`. It is distinct from Vercel's runtime `DATABASE_URL`, which must connect as the restricted `app_server` role.

Required production Vercel variables:

- `APP_ENV=production`
- `APP_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- restricted-role `DATABASE_URL`
- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET`
- `EMAIL_FROM`
- real `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- real `TURNSTILE_SECRET_KEY`
- `CRON_SECRET` (random, at least 16 characters)
- `HEALTH_ALERT_EMAIL` (recommended)

`EMAIL_DRY_RUN` must be absent in production. Even if it is accidentally set, the application refuses to dry-run when `APP_ENV=production`.

### Scheduled health check

`vercel.json` schedules a daily Vercel Cron call to `GET /api/health`, which runs `select 1` against the database. It returns `200 {"ok":true}` or `503 {"ok":false}` and never includes error details. Vercel attaches `Authorization: Bearer $CRON_SECRET` to cron invocations; without `CRON_SECRET` the route answers `500` to every request. On a database failure it emails `HEALTH_ALERT_EMAIL` if set and logs the Postgres or driver error code under `[hc] [health]`.

The production Supabase project is on the Pro plan, which is not paused for inactivity, so the check serves as an outage alarm. On the Free plan it would also keep a project from being paused after a week without enough database activity ([Supabase: Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing)). Hobby plans allow cron jobs at most once per day and may fire anywhere within the scheduled hour ([Vercel: Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)).

Cron jobs run only on the production deployment. Runs appear under **Settings → Cron Jobs → View Logs**.

### Production configuration status

Production project variables and the GitHub migration credential are configured. The runtime connects as the rotated `app_server_v2` role (verified 2026-08-10); retiring the superseded `app_server` login is tracked in #20. Production Google OAuth now uses the dedicated client owned by the Sealed Google Cloud project.

## Migration policy

- CI tests every migration against a disposable local stack.
- Migrations reach production only after merge, in the deploy workflow, immediately before the code that uses them. PRs never touch the production database.
- Every migration must be backward-compatible with the code currently live, because it runs a few minutes before that code is replaced. Use expand/migrate/contract steps across PRs for anything destructive.
- Create migrations with `supabase migration new <name>` so versions are timestamps; hand-numbered versions from two branches can collide.
- Start every new migration with `set local lock_timeout = '5s';` so a migration waiting on a busy table fails instead of stalling the app's queries behind it. `scripts/ci/migrations.test.ts` enforces this for every migration after `00000000000003`.
- Never edit a migration after it has been applied to production; add a new one.
- Database rollback is not automatic; write corrective forward migrations.

## Secrets and ownership

- `.env.local` is ignored and contains local-only credentials.
- Vercel owns runtime application secrets.
- The GitHub `Production` environment owns the migration and Vercel deploy secrets.
- Google Cloud owns OAuth client secrets.
- Supabase project keys are environment-specific.
- Never expose database URLs, Resend keys, Turnstile secrets, Supabase secret/service-role keys, or OAuth secrets to the browser.

## Operational verification

Before considering an environment ready:

- `/login` magic-link flow reaches `/auth/confirm` and then `/dashboard` or `/onboarding`.
- Google OAuth returns through `/auth/confirm`, not `/?code=...`.
- New owners can complete onboarding.
- Owners can create/edit/import/export contacts.
- Recipient links are write-only and rate-limited.
- Production uses the restricted runtime database role (`app_server_v2`).

The repeatable release procedure and failure recovery are in [the environment promotion runbook](runbooks/promote-environments.md).

## Primary references

- Vercel environment variables: <https://vercel.com/docs/environment-variables>
- Vercel Git deployments: <https://vercel.com/docs/git>
- Supabase local development: <https://supabase.com/docs/guides/local-development>
- Supabase redirect URLs and wildcards: <https://supabase.com/docs/guides/auth/redirect-urls>
- Supabase Google Auth: <https://supabase.com/docs/guides/auth/social-login/auth-google>
- Supabase CLI database migrations: <https://supabase.com/docs/reference/cli/supabase-db-push>
- GitHub deployment environments: <https://docs.github.com/actions/deployment/targeting-different-environments/using-environments-for-deployment>
