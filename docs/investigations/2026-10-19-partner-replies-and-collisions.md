# Partner replies and reply collisions

- **Date:** 2026-10-19
- **Status:** Current
- **Prompted by:** Feature build (#95, email both partners in a couple)
- **Last verified:** `feat/partner-email-backend` on 2026-10-19
- **Related:** #95, #88 (owner notification), #83 (link retirement)

## Question

When both people in a couple get their own link, how does the backend keep
their replies apart, and what happens when both answer at once?

## Key findings

- Each link, send and token change carries a `recipient` (`primary` or
  `partner`): `update_tokens.recipient`, `email_sends.recipient` and
  `contact_events.recipient`. Rows from before the change are `primary`.
- A recipient's `email` field is their own address. `get_contact_for_token`
  returns `partner_email` as `email` for a partner link, and
  `apply_token_update` writes it back to `partner_email`. The partner never
  sees the primary's email.
- `private.apply_token_update(p_token, p_payload, p_seen_at default null)`
  returns `'applied'`, `'queued'` or NULL (refused). NULL `p_seen_at` skips the
  collision check.
- A reply is a collision when `contacts.updated_at > p_seen_at` and the newest
  `contact_events` row after `p_seen_at` is a token change by the other
  recipient. A colliding reply that would change nothing counts as a confirm
  (`'applied'`, event recorded, contact untouched). One that differs is
  inserted into `submissions` as pending with `matched_contact_id`, spends the
  token, records no event, and returns `'queued'`.

## How it works

- `supabase/migrations/20261020120000_partner_email.sql` holds the schema,
  the two per-recipient revoke triggers and both functions.
- The page reads `updated_at` from `get_contact_for_token` and posts it back as
  the hidden `seen_at` input (`RecipientForm`, `ConfirmEnvelope`);
  `readSeenAt` in `src/app/u/[token]/token-data.ts` validates it.
- To learn whether a colliding reply changes anything, the function runs the
  normal UPDATE inside a `begin … exception when sqlstate 'SL001'` block,
  reads the row, then raises `SL001`. The savepoint rolls back the update and
  any trigger work; the plpgsql variable holding the would-be row survives.
- `SELECT … FOR UPDATE` on the contact serializes two concurrent replies, so
  the second one sees the first one's event.
- `notifyOwner({ queued })` sends `contactNeedsReviewEmail` for a queued reply.

## Gotchas

- `seen_at` must be the Postgres text, not a JS `Date`: a `Date` drops the
  microseconds, so `updated_at > seen_at` would be true on every reply.
- A confirm with `{}` still runs the UPDATE when there is no collision, which
  bumps `updated_at`. That is pre-existing behavior.
- The queued payload drops empty strings and empty arrays, and stores a
  partner's email as `partner_email`. The review merge ignores that key today,
  so approving a queued partner reply does not change `partner_email`.
- A recipient email that matches the other person's address is ignored
  rather than tripping `contacts_partner_email_differs`.
- `citext`'s `=` lives in `extensions`. The revoke triggers compare
  `lower(...::text)` so they behave the same under any `search_path`; a
  `pg_dump` restore turned the old `IS DISTINCT FROM` into a case-sensitive
  text comparison.

## Open questions

- The review card and the "Two answers" chip are UI work pending design.

## References

- `supabase/tests/database/07_partner_email.sql`
- `src/app/u/[token]/actions.test.ts`, `src/app/u/[token]/confirm/actions.test.ts`
- `src/app/dashboard/actions.ts` (`requestAddresses`), `src/lib/recipients.ts`
