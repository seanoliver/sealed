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
- `planDuplicateMerge` in `src/lib/duplicate-merge.ts` is the only thing that
  decides what a merge fills. `mergeDuplicateAs` in
  `src/app/dashboard/review/duplicates.ts` applies it and refuses when either
  contact's `updated_at` moved or the deleted contact has a pending submission.

## Gotchas

- Merging deletes a contact, and there is no owner undo. Its links, sends and
  events cascade. `diff.merged_from` on the kept contact's history event is the
  only record left, so it is written in the merge's transaction, through the
  `contact_events_insert_merge` policy, not after commit like other owner events.
- Values follow people. `pairSlots` lines the two contacts up person by person.
  An email or birthday whose owner has no slot on the kept contact is reported
  in `notKept`, never placed. A birthday belongs to the contact's own person, so
  a swapped pair's birthday is lost rather than moved.
- Marking a pair changes neither contact, so the version check cannot see it.
  The merge rechecks dismissals itself.
- Delete before filling. The kept contact may take the deleted contact's email,
  and `contacts_book_email_unique` would reject it the other way round.
- Do not reuse `mergeUpdate` for a merge. It has no `notes`, and it overwrites
  rather than fills.
- A pending reply on the deleted contact blocks the merge. Repointing it could
  apply one person's reply to another person's fields.
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
- A permalink submit that lands while a merge deletes its matched contact waits
  on the row lock, then fails the FK, so the visitor sees the generic error. A
  plain delete does the same.
- A dismissal cannot be undone: clients have no DELETE on the table.

## References

- `src/lib/household-match.ts`, `src/lib/duplicate-merge.ts`
- `src/app/dashboard/review/duplicates.ts`, `src/app/dashboard/review/page.tsx`
- `src/lib/queries/duplicates.ts`, `src/lib/agent/read.ts` (`findDuplicates`)
- `supabase/migrations/20261107120000_duplicate_dismissals.sql`
- `supabase/tests/database/12_duplicate_dismissals.sql`
