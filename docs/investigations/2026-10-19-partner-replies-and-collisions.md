# Partner replies and reply collisions

- **Date:** 2026-10-19
- **Status:** Current
- **Prompted by:** Feature build (#95, email both partners in a couple)
- **Last verified:** `feat/partner-email-backend` on 2026-10-19 (after PR #105 review round 1)
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
  `apply_token_reply` writes it back to `partner_email`. The partner never
  sees the primary's email.
- `private.apply_token_reply(p_token, p_payload, p_seen_at default null)`
  returns `'applied'`, `'queued'` or NULL (refused). NULL `p_seen_at` skips the
  collision check. The app calls only this.
- `private.apply_token_update(p_token, p_payload)` keeps its old boolean
  contract (true when applied or queued) as a wrapper. Production deploys run
  `supabase db push` before `vercel deploy`, and a Vercel rollback can leave
  the old app running, so the old app must keep working against the new
  database.
- A reply is a collision when `contacts.updated_at > p_seen_at` and some token
  event by the other recipient after `p_seen_at` changed data (its `diff`
  `before` differs from `after`). An owner edit in between does not hide it,
  and the other person's no-op confirm does not cause one. Token events store
  `{before, after, payload}`; events from before this migration have no
  `after`, so they count as changes.
- A colliding reply that would change nothing counts as a confirm
  (`'applied'`, event recorded, contact untouched). One that differs is
  inserted into `submissions` as pending with `matched_contact_id`,
  `source = 'token'`, `recipient` (who sent it) and `saved_by` (whose change
  it would replace). It spends the token, records no event, and returns
  `'queued'`. Permalink submissions get `source = 'permalink'` and no people.

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
- The sheet's "Two answers" chip lists only `source = 'token'` submissions
  (`listPendingReplies`) and names each side from `recipient` and `saved_by`.
  Permalink matches appear only on `/dashboard/review`.
- Approving a token reply (`approveMerge`) strips its empty values before the
  strict parse, then clears the fields they emptied (`clearedFields`): address
  fields, birthday, the partner group, the kids group. Emails and names never
  clear. `mergeUpdate` also writes a queued `partner_email`.
- `requestAddresses` takes contact ids (everyone with an address) or
  `recipients` (one person each). With Needs attention on, the sheet sends
  only to people whose latest send failed, bounced, complained or went
  unconfirmed, so the other person keeps their live link.

## Gotchas

- `seen_at` must be the Postgres text, not a JS `Date`: a `Date` drops the
  microseconds, so `updated_at > seen_at` would be true on every reply.
- A confirm with `{}` still runs the UPDATE when there is no collision, which
  bumps `updated_at`. That is pre-existing behavior.
- The queued payload keeps empty strings and empty arrays, because approving
  it must be able to clear a field, and stores a partner's email as
  `partner_email`.
- A recipient email that matches the other person's address is ignored
  rather than tripping `contacts_partner_email_differs`.
- `citext`'s `=` lives in `extensions`. The revoke triggers compare
  `lower(...::text)` so they behave the same under any `search_path`; a
  `pg_dump` restore turned the old `IS DISTINCT FROM` into a case-sensitive
  text comparison.

## Open questions

- None.

## References

- `supabase/tests/database/07_partner_email.sql`
- `src/app/dashboard/review/actions.test.ts`, `src/app/dashboard/review/merge.test.ts`
- `src/lib/queries/submissions.ts` (`listPendingReplies`), `src/lib/contacts-sheet.ts` (`twoAnswers`, `sendPlan`)
- `src/app/u/[token]/actions.test.ts`, `src/app/u/[token]/confirm/actions.test.ts`
- `src/app/dashboard/actions.ts` (`requestAddresses`), `src/lib/recipients.ts`
