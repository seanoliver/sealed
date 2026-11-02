# Contact event diff shapes

**Date:** 2026-11-02
**Status:** Current
**Prompted by:** Feature build
**Last verified:** `670f35d` on 2026-11-02
**Related:** #130 (Contact History shows raw JSON)

## Question

What shapes does `contact_events.diff` take, so the History list on the contact page can turn each one into readable rows?

## Key findings

- Five shapes exist. Only `diff.before` tells an edit from a create.
- Owner, agent and submission edits store changed fields only. Token replies store whole rows, including `id` and `book_id`.
- Older token replies (before `20261020120000_partner_email.sql`) have no `after`. Their `payload` is what the recipient sent, not what the function applied (it skipped disabled fields and blank emails and rebuilt display names), so History shows them as "Details changed".
- Bulk CSV import and deletes write no events.
- `seedPendingReply` in `e2e/db.ts` writes a token event with `diff = {}`. It reads as "Details changed".

## How it works

| Writer | Source | Shape |
|---|---|---|
| `changedFields` in `src/app/dashboard/contacts/write.ts` (owner, agent, sheet, merge approval) | owner, agent, submission | `{ before, after }`, changed snapshot fields only, keyed by form names |
| `definedFields` on create and on approving a new submission | owner, agent, submission | `{ after }`, every non-empty field |
| `undoAgentChange` in `src/lib/agent/changes.ts` | agent or owner | `{ before, after, undo_of }` |
| `private.apply_token_reply` (`20261024120000_address_formats.sql`) | token | `{ before, after, payload }`. Rows are `to_jsonb(contacts) - created_at - updated_at`; a one-click confirm has `before = after` |
| `private.apply_token_update` (`00000000000002`, `00000000000005`) | token | `{ before, payload }`. Payload values are untrimmed; the function stored `nullif(trim(v), '')` |

`describeEvent` in `src/lib/history.ts` reads all five. It shows the display names (`full_name`, `partner_name`, `kids_names`) and never the first/last split, because the trigger derives the display strings from the split (ADR 0001).

## Gotchas

- In a partial diff, a key that appears on only one side says nothing about the other side. Compare only keys present on both.
- `country` is the legacy free-text country. Read it together with `country_code` as one "Country" row.
- Address labels depend on the country (`fieldLabel` in `src/lib/address/fields.ts`). Partial diffs often lack `country_code`, so fall back to the contact's current country.
- `isNoOpReply` in `src/lib/contacts-sheet.ts` needs `before` and `after` to be exactly equal. A reply that only moves the name split is not a no-op there, but History shows it as confirmed because nothing visible changed.

## Open questions

None.

## References

- `src/lib/history.ts`, `src/lib/history.test.ts`
- `src/app/dashboard/contacts/[id]/contact-history.tsx`
- `e2e/contact-history.spec.ts`
- `supabase/migrations/20261024120000_address_formats.sql`
