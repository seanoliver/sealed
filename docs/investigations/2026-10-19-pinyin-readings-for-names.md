# Pinyin readings for names in Chinese characters

- **Date:** 2026-10-19
- **Status:** Current
- **Prompted by:** Feature build
- **Last verified:** review round 1 fixes on 2026-10-19
- **Related:** Issue #110

## Question

How do owner-only pinyin readings get generated, overridden, rendered and searched, and what keeps them away from recipients?

## Key findings

- `pinyin-pro` 3.29.4 is server-only (`src/lib/pinyin.ts`). Its person-name mode is the `surname` option (`"off" | "all" | "head"`, in `types/core/pinyin/index.d.ts`); `mode: "surname"` is the older form and defaults to `all`. Surname mode applies only to the run that is the surname: the last name of a split name (generated together with the first name, last name first), a single run holding a whole name, or the last run of an unsplit name stored given name first ("华 李" → Huá Lǐ, not Huà).
- pinyin-pro is imported lazily (`await import("pinyin-pro")`) and only when a name has Han characters, so pages and routes for books without them never load its dictionary. `src/lib/queries/contacts-pinyin-load.test.ts` checks this.
- The client never loads pinyin-pro. The server builds a `Readings` map (Han run → syllables) per contact, and the client looks runs up in it (`src/lib/readings.ts`). A run the map lacks, such as a name typed into an open inline edit, renders as plain text.
- Overrides live in `contacts.name_reading` and `partner_name_reading`. They are not in `CONTACT_FIELDS`, so CSV export/import and the token schemas never see them. `private.get_contact_for_token` lists its fields explicitly; `supabase/tests/database/08_name_readings.sql` checks the token data has no reading.
- Search stays server-side: a pinyin-looking query also pulls rows whose names contain Han characters (Postgres regex), and `listContacts` filters those in JS with `matchesReading`.

## How it works

- `overrideReadings` splits the owner's text into exactly as many syllables as the name has Han characters (`splitReading`, a DP over a permissive pinyin syllable regex). If the count can't match, one-run names get the whole override as a single `rt`.
- `NameWithReading` renders `<ruby>` with one `<rt>` per character. The ruby is `aria-hidden` and an `sr-only` copy carries the plain name.
- The `contacts_sync_readings` BEFORE UPDATE trigger nulls `name_reading` when `full_name` changes and `partner_name_reading` when `partner_name` changes (including partner removal), unless the same update also changes that reading. It covers the owner form, the sheet, token replies and approved merges. It is named to fire after `contacts_sync_names`, which rebuilds the display names.
- Stored names are given name first ("雨桐 曾") but owners often write readings surname first. With several runs, `overrideReadings` tries both run orders and keeps the one whose syllables match the generated reading, ignoring tones; `matchesReading` accepts either order too.
- Submitted names for Two answers and review cards come from `submittedPeople`, which keeps the payload's first and last names so generation can tell the surname apart.

## Gotchas

- Ruby inside a link changes its accessible name to "张 伟" (one word per base). Hence the `sr-only` copy.
- `rt` doesn't grow a fixed-height table row. The Name cell uses `has-[ruby]:py-1` and the wrapper raises `line-height`.
- Without an apostrophe, joined pinyin like "nàna" is ambiguous; the splitter prefers splits where later syllables start with a consonant.

## Open questions

- Generation only knows the stored name, so the contact form can't suggest a reading for a name typed but not yet saved.

## References

- `src/lib/pinyin.ts`, `src/lib/readings.ts`, `src/components/name-with-reading.tsx`, `src/components/reading-field.tsx`
- `supabase/migrations/20261022120000_name_readings.sql`, `e2e/pinyin-names.spec.ts`
- `node_modules/pinyin-pro/README.md`, `node_modules/pinyin-pro/types/common/type.d.ts`
