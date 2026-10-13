# Environments and promotion

Sealed runs in three isolated environments. `APP_ENV` is the application-level environment selector; do not use `NODE_ENV` for this distinction because Vercel Preview deployments also run with `NODE_ENV=production`.

## Environment matrix

| Concern | Local | Staging | Production |
|---|---|---|---|
| Application | `http://localhost:3000` | `sealed-staging` Vercel project, including every PR preview | `address-book` Vercel project |
| Supabase | CLI stack | `sealed-staging` (`fmjbjkcuyqopoubbylme`) | `address-book` (`ivwrvilpjhqhmlzwgyot`) |
| Database data | Disposable local fixtures | Synthetic test data only | Real owner/contact data |
| Email | Mailpit and dry-run logs | Dry-run logs until a restricted staging sender is configured | Resend production sender |
| Turnstile | Cloudflare test keys | Cloudflare test keys initially | Real production widget |
| Google OAuth | Dedicated local client | Dedicated staging client | Dedicated production client |

The two hosted Supabase projects must never share credentials, users, or database data. Never copy production contact data into staging.

## URL rules

`APP_URL` is the **canonical URL** used in outgoing email and public address-book links:

- Local: `http://localhost:3000`
- Staging: `https://sealed-staging.vercel.app`
- Production: the production domain

OAuth callbacks initiated on a Vercel preview should use that request's origin so the browser returns to the same preview. Supabase staging must allow both the canonical staging callback and the Vercel preview-domain wildcard. Production Supabase must allow only production callbacks.

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

## Staging

### Provisioned infrastructure

- Supabase project: `sealed-staging` (`fmjbjkcuyqopoubbylme`), `us-east-1`
- Vercel project: `sealed-staging` (`prj_U3UvwU863EZVmb9up3Z0M28GQWQQ`)
- GitHub environment: `Staging`
- Restricted database runtime role: `app_server`
- Migrations `00000000000001` through `00000000000003` applied

The staging Vercel project's Production and Preview variables both point to staging Supabase. It is the only Vercel project connected to GitHub, so PR preview links cannot accidentally use production infrastructure.

### Hosted configuration

Staging Supabase is configured with:

- Site URL `https://sealed-staging.vercel.app`
- Redirect allow-list entries for the new and legacy stable staging URLs plus this project's Vercel preview wildcard
- A dedicated Google OAuth client owned by the Sealed Google Cloud project
- Only an empty, ungranted `api` schema exposed through the Data API; application data is not exposed

The custom magic-link template in `supabase/templates/magic_link.html` remains local-only while staging uses Supabase's free-tier default email provider: hosted template modification requires either custom SMTP or a paid Supabase plan. The default provider is intentionally retained until staging-auth recipient policy is decided.

The staging Google client callback is:

```text
https://fmjbjkcuyqopoubbylme.supabase.co/auth/v1/callback
```

Staging currently uses email dry-run and Turnstile test keys. This is deliberate. Do not configure real staging email until recipient restrictions prevent accidental sends to arbitrary addresses.

### Staging deployment

Git-connected Vercel deployments handle `main` and pull requests. After CI succeeds on `main`, `.github/workflows/deploy-staging.yml` applies committed migrations to staging. `STAGING_DATABASE_URL` must be an owner-role Supabase **session-pooler** URL on port 5432; GitHub-hosted runners cannot reach the project's IPv6-only direct database endpoint, while transaction pooling on port 6543 is incompatible with the CLI's prepared statements. Database-changing PR previews therefore run against the last merged staging schema; keep migrations backward-compatible.

## Production

Production Vercel is intentionally disconnected from GitHub. This prevents it from creating PR previews with production credentials.

A production release is explicit:

1. Confirm the commit has passed CI and staging verification.
2. Run the **Deploy production** GitHub workflow with that exact SHA or tag.
3. The protected `Production` job applies migrations first.
4. Vercel builds and deploys the same checked-out ref.
5. Run non-destructive smoke checks after deployment.

Required GitHub Production secret:

```text
PRODUCTION_DATABASE_URL
```

This migration URL connects as the Supabase database owner and is available only to the protected deployment job. It must use the IPv4 session pooler on port 5432 for GitHub-hosted runners; the transaction pooler on port 6543 can retain the CLI's prepared statements across clients and fail retries with `SQLSTATE 42P05`. It is distinct from Vercel's runtime `DATABASE_URL`, which must connect as the restricted `app_server` role.

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

The check keeps the Supabase Free project from being paused for inactivity, which happens after a week without enough database activity ([Supabase: Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing)). Hobby plans allow cron jobs at most once per day and may fire anywhere within the scheduled hour ([Vercel: Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)).

Cron jobs run only on a project's production deployment, and `vercel.json` applies to both Vercel projects. Set `CRON_SECRET` in the staging project too, or its daily run returns `500`. Runs appear under **Settings → Cron Jobs → View Logs** in each project.

### Production configuration status

Production project variables and the protected GitHub migration credential are configured. The existing deployment remains live with its original environment snapshot; the next approved deployment will use the rotated `app_server_v2` runtime credential. The original `app_server` login must remain active until that deployment is verified, after which its old login credential can be retired. Production Google OAuth now uses the dedicated client owned by the Sealed Google Cloud project.

## Migration policy

- CI tests every migration against a disposable local stack.
- PRs never mutate staging or production databases.
- Successful `main` CI applies migrations to staging.
- Production migration and deployment happen in one manually dispatched workflow.
- Prefer expand/migrate/contract changes so old and new application versions can overlap safely.
- Database rollback is not automatic; write corrective forward migrations.

## Secrets and ownership

- `.env.local` is ignored and contains local-only credentials.
- Vercel owns runtime application secrets.
- GitHub Environments own migration/deployment secrets.
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
- Staging sends no real address-request email.
- Production uses the restricted `app_server` database role.

The repeatable release procedure and failure recovery are in [the environment promotion runbook](runbooks/promote-environments.md).

## Primary references

- Vercel environment variables: <https://vercel.com/docs/environment-variables>
- Vercel Git deployments: <https://vercel.com/docs/git>
- Supabase local development: <https://supabase.com/docs/guides/local-development>
- Supabase redirect URLs and wildcards: <https://supabase.com/docs/guides/auth/redirect-urls>
- Supabase Google Auth: <https://supabase.com/docs/guides/auth/social-login/auth-google>
- Supabase CLI database migrations: <https://supabase.com/docs/reference/cli/supabase-db-push>
- GitHub deployment environments: <https://docs.github.com/actions/deployment/targeting-different-environments/using-environments-for-deployment>
