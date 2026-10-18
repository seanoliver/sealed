# ADR-0001: Structured household names with derived display strings

**Date:** 2026-10-14
**Status:** Accepted
**Decision owners:** Product owner
**Related:** `supabase/migrations/00000000000004_household_names.sql`, `src/lib/names.ts`

## Context

Contacts stored one free-text string per person group: `full_name`,
`partner_name`, and `kids_names`. Addressing mail needs first and last names
for the recipient, a partner, and each kid, but every existing surface
(contact list, CSV export, `/u/[token]`, owner edits) reads and writes the
display strings, and existing rows cannot be split reliably.

## Decision

- `contacts` gains `first_name`, `last_name`, `partner_first_name`,
  `partner_last_name` (each 1–80 chars) and `kids` (jsonb array of
  `{first, last?}`, 1–10 items, validated by `private.valid_kids`).
- The display strings stay and are derived by the `BEFORE INSERT OR UPDATE`
  trigger `private.sync_contact_names()`:
  - a set structured group overwrites its display string
    (`private.format_person`, `private.format_kids`);
  - a write that changes a display string without changing its structured
    group NULLs that group, so the two never disagree.
- Kids who share the contact's last name (or have none) display by first
  name only; others display by full name.
- Existing rows keep NULL structured fields; nothing is parsed server-side.
  `naiveSplit` and `splitKids` in `src/lib/names.ts` exist only to prefill
  forms from legacy strings.
- Submissions from `/b/[slug]` store the household shape; approval accepts
  household and legacy payloads.
- `/u/[token]`, the owner contact form, and the contacts sheet edit the
  household too. Their writers set the structured groups and the display
  strings together, so removing a partner or every kid clears the string
  as well (the trigger only derives from a set group).
  `private.apply_token_update` accepts the structured keys with the same
  `enabled_fields` gating as the display strings
  (`00000000000005_token_household_names.sql`).
- CSV export adds the structured columns after the display names; CSV
  import still reads only the display names.

## Alternatives considered

### Drop the display strings and format on read

Every reader would need to change at once, including `/u/[token]` and CSV
export, and legacy rows would have nothing to format from.

### Derive display strings in application code only

Owner edits, CSV import, token updates, and approvals each write contacts;
any path that forgot to re-derive would leave the two forms out of sync.

## Consequences

### Positive

- Legacy writers keep working unchanged; the trigger keeps them consistent.
- Structured names are available for addressing without a backfill.

### Negative

- `src/lib/names.ts` must mirror the SQL format functions exactly.
- Editing a display string discards the structured group it came from.

## Verification

- `supabase/tests/database/03_household_names.sql` covers trigger behaviour
  and `valid_kids`, and holds the parity fixture.
- `src/lib/names.test.ts` runs the same fixture against the TypeScript
  formatters.
- `supabase/tests/database/04_token_household_names.sql` covers token
  update gating and the audit allowlist.
