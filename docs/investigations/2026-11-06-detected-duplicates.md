# Detected duplicates by name

**Date:** 2026-11-06
**Status:** Current
**Prompted by:** Feature build
**Last verified:** branch `dedupe-contacts-by-name` on 2026-11-06
**Related:** `docs/investigations/2026-10-19-partner-replies-and-collisions.md`, ADR-0001

## Question

How can Sealed treat "Theo & Nina" and "Nina & Theo" as one household when two
different people can share a name, and when a permalink submit must not reveal
whether it matched anything?

## Key findings

- Duplicates are computed on read, never stored. `detectDuplicates` in
  `src/lib/household-match.ts` runs over the book, so import, manual add, token
  edits and the first cleanup all surface through one path, and an edit or
  delete cannot leave a stale pair. Only "Not duplicates" is stored, in
  `contact_duplicate_dismissals`.
- A match only flags a pair. Nothing in the matcher merges, skips or deletes.
- `same_people` means every person pairs up. `shares_person` means at least one
  does, as with "Maya Chen" and "Maya Chen & Jordan Lee".
- `private.submit_to_book` is unchanged and still matches on email only. A name
  match on an invite reply is worked out in `toCardModel` when the owner opens
  Review, so the public path has no new branch, query or timing difference.
- A name match never brings an email. `approveMergeAs` drops `email` and
  `partner_email` when the target came from Compare, because anyone can type a
  contact's name and an email would redirect their next request.

## How it works

- `peopleIn` turns a contact into people. It reads the structured columns when
  they are set and `full_name` / `partner_name` otherwise. Those strings split
  on `&`, `+`, `/` and `and`, so a couple typed into the name field counts as
  two people. A household label ("Satya & Family", "The Smiths") stays whole.
- A one-word name takes the household's last name, as `householdLine` prints
  it. A name that still has no last name matches any last name.
- Normalizing drops case, Latin accents, apostrophes and periods, and treats
  other punctuation as a space. Han and other scripts compare exactly.

## Gotchas

- There is no merge, on purpose. Copying values between contacts assumes they are
  one person, and a name can't prove that: an email moved onto a real contact,
  or a real address moved onto a stranger's email, would send that contact's
  link and home address to the wrong person. Review links both contacts, and the
  owner deletes one from its contact page.
- Compare offers Apply only when `sameSlots` holds, because `mergeUpdate` writes a
  reply's names into the slots it arrived in.
- `find_duplicates` also reports email and street matches. Those are facts and
  do not honor dismissals; only its name matches do.
- Vitest files use fixed fixture ids, so two checkouts testing against the one
  local database collide with `books_pkey` errors and hook timeouts.

## Open questions

- Nicknames and typos are not matched.
- "X & Family" labels never match "X Lastname".
- A multi-word surname on one person only: "Ana de la Cruz & Bob" gives Bob the
  last word, so he misses "Bob de la Cruz". "Marsh, Theo" and letters like ø
  that have no accent to strip do not match either.
- A dismissal cannot be undone: clients have no DELETE on the table.

## References

- `src/lib/household-match.ts`, `src/app/dashboard/review/page.tsx`
- `src/lib/queries/duplicates.ts`, `src/lib/agent/read.ts` (`findDuplicates`)
- `supabase/migrations/20261107120000_duplicate_dismissals.sql`
- `supabase/tests/database/12_duplicate_dismissals.sql`
