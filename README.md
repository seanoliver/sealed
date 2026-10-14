# Sealed

Sealed is an open-source, self-hostable address book for people who mail things to people — holiday cards being the canonical use case.

Each owner has one personal address book, identified by their display name rather than a separate book title. Each year (or whenever), you email contacts a unique, expiring link where they confirm or update **their own** address — no account needed on their end. You also get a shareable permalink where people can add themselves to your book, write-only: visitors can never see what's in it. When it's time to print labels, export everything as CSV.

Security is the top design priority: this app stores home addresses, and leaking them is the failure mode the architecture is built around. Read [docs/SECURITY.md](docs/SECURITY.md) for the full security model.

## Features

- **Contact list** with partner names, kids' names, birthdays, and international-friendly structured addresses
- **"Request addresses" in bulk** — each contact gets a personal, single-use link (30-day expiry) to update their own info
- **Send-status tracking** — per-contact chips (sent / delivered / opened / bounced / updated) driven by signed Resend webhooks
- **Public permalink** (`/b/your-slug`) — a write-only self-add form; submissions land in a review queue where you approve, merge, or reject
- **Review queue with merge** — self-adds that match an existing contact's email surface as "possible update" with a side-by-side diff
- **CSV import** (header-alias tolerant, previewed in the browser) and **CSV export** (RFC 4180, formula-injection safe, round-trips through import)
- **Audit trail** per contact — every owner edit, token update, and approved submission is recorded
- **Passwordless auth** — magic link or Google, via Supabase Auth
- **Guided onboarding** — add your display name, edit an email-derived link suggestion, and preview the invite page before publishing it
- **Live invite-page configuration** — toggle partner name, kids' names, and birthday while seeing the same inert preview in onboarding and Settings

## Screenshots

_Coming soon._

## Local development

Prereqs: [Node.js](https://nodejs.org) ≥ 20.12, [pnpm](https://pnpm.io) (`corepack enable`), and [Docker](https://docs.docker.com/get-docker/) (for the local Supabase stack).

```bash
pnpm install
cp .env.local.example .env.local
# Fill and export the two SUPABASE_AUTH_EXTERNAL_GOOGLE_* values from your
# dedicated local Google Web OAuth client. An ignored .envrc + direnv works well.
pnpm supabase start          # boots local Postgres/Auth/Mailpit; prints keys
# paste the anon key printed by `supabase start` into NEXT_PUBLIC_SUPABASE_ANON_KEY
pnpm dev                     # http://localhost:3000
```

Magic-link emails land in the local Mailpit UI at http://127.0.0.1:54324. With `EMAIL_DRY_RUN=1` (the default in the example env), address-request emails are not sent — the tokenized links are printed to the dev-server console instead.

### Tests

```bash
pnpm test      # Vitest unit + integration (needs `supabase start` running)
pnpm test:db   # pgTAP suite: RLS policies, grants, SECURITY DEFINER functions
pnpm e2e       # Playwright happy paths (starts/reuses the dev server)
```

## Environment variables

All of these live in `.env.local` (gitignored). See [.env.local.example](.env.local.example) for local-dev defaults.

| Variable | Description |
|---|---|
| `APP_ENV` | Explicit runtime environment: `local` or `production`. Do not infer this from `NODE_ENV`; every Vercel deployment uses `NODE_ENV=production`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. Used for **auth only** — the browser never touches Supabase data APIs. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (publishable) key. Auth only, same as above. |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` | Local Supabase CLI Google Web OAuth client ID; export before starting Supabase. |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` | Local Supabase CLI Google Web OAuth client secret; export before starting Supabase. |
| `DATABASE_URL` | Direct Postgres connection for Drizzle (server only, never exposed to the client). In production: the transaction pooler on port 6543 with `sslmode=require`. |
| `RESEND_API_KEY` | [Resend](https://resend.com) API key for sending address-request emails. |
| `RESEND_WEBHOOK_SECRET` | Signing secret (svix, `whsec_…`) for verifying `/api/webhooks/resend` events. |
| `EMAIL_FROM` | From header for outgoing email, e.g. `"Sealed <addresses@example.com>"`. Must be a domain verified in Resend. |
| `EMAIL_DRY_RUN` | Set to `1` to log tokenized links instead of sending email. Allowed only when `APP_ENV` is `local`; always ignored in production. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key. The example value is Cloudflare's public always-pass test key. |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret key. The example value is Cloudflare's public always-pass test key. |
| `APP_URL` | Canonical base URL of the deployment — used to build the links in outgoing emails. |
| `ADMIN_EMAILS` | Comma-separated emails that can open `/admin/waitlist` to approve beta invitations. Everyone else gets a 404 there. |

Required vars are asserted at server startup (`src/lib/env.ts`); a misconfigured deployment fails loudly with the list of missing names.

The local and production environments and the release workflow are documented in [docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md).

## Deploying

The reference deployment is **Vercel + hosted Supabase + Resend + Cloudflare Turnstile**:

1. Create a [Supabase](https://supabase.com) project and push the schema: `supabase link --project-ref <ref> && supabase db push`.
2. **Work through the [production checklist in docs/SECURITY.md](docs/SECURITY.md#production-checklist)** — most importantly: remove all exposed schemas from the Data API, and use the transaction-pooler `DATABASE_URL` (port 6543, `sslmode=require`). Connect as a restricted `app_server` role rather than `postgres` — the tested one-time SQL is in the [Database role](docs/SECURITY.md#database-role) section.
3. Self-hosting off Vercel? Run behind a proxy that sets `x-forwarded-for` — without it, rate limiting lumps all visitors into one shared bucket (see the [self-hosting note](docs/SECURITY.md#rate-limits)).
4. Create a [Resend](https://resend.com) account, verify your sending domain (SPF/DKIM), and add a webhook endpoint pointing at `https://<your-app>/api/webhooks/resend`.
5. Create a [Cloudflare Turnstile](https://www.cloudflare.com/application-services/products/turnstile/) widget for your domain (the test keys in the example env pass every challenge — never ship them).
6. Deploy to [Vercel](https://vercel.com): import the repo, set every variable from the table above (marked **Sensitive**), and deploy.
7. Set the Supabase Auth **Site URL** to your `APP_URL` and configure the magic-link email template to link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` (see `supabase/templates/magic_link.html`).

## Contributing

Issues and PRs welcome. Before opening a PR, run the full gate locally:

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm test:db && pnpm build && pnpm e2e
```

New tables must ship with RLS policies and pgTAP coverage — the test suite fails otherwise (by design; see [docs/SECURITY.md](docs/SECURITY.md)). To report a security issue, **do not open a public issue** — see the [vulnerability reporting section](docs/SECURITY.md#reporting-a-vulnerability).

## License

[MIT](LICENSE)
