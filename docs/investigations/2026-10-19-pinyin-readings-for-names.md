# Pinyin readings for names in Chinese characters

**Date:** 2026-10-19
**Status:** Current
**Prompted by:** Feature build
**Last verified:** `775a567` on 2026-10-19
**Related:** Issue #110

## Question

How do owner-only pinyin readings get generated, overridden, rendered and searched, and what keeps them away from recipients?

## Key findings

- `pinyin-pro` 3.29.4 is server-only (`src/lib/pinyin.ts`). Its person-name mode is the `surname` option (`"off" | "all" | "head"`, in `types/core/pinyin/index.d.ts`); `mode: "surname"` is the older form and defaults to `all`. The app uses `surname: "head"` per Han run, so 曾 reads zēng and 单 reads shàn only at the start of a name.
- The client never loads pinyin-pro. The server builds a `Readings` map (Han run → syllables) per contact, and the client looks runs up in it (`src/lib/readings.ts`). A run the map lacks, such as a name typed into an open inline edit, renders as plain text.
- Overrides live in `contacts.name_reading` and `partner_name_reading`. They are not in `CONTACT_FIELDS`, so CSV export/import and the token schemas never see them. `private.get_contact_for_token` lists its fields explicitly; `supabase/tests/database/08_name_readings.sql` checks the token data has no reading.
- Search stays server-side: a pinyin-looking query also pulls rows whose names contain Han characters (Postgres regex), and `listContacts` filters those in JS with `matchesReading`.

## How it works

- `overrideReadings` splits the owner's text into exactly as many syllables as the name has Han characters (`splitReading`, a DP over a permissive pinyin syllable regex). If the count can't match, one-run names get the whole override as a single `rt`.
- `NameWithReading` renders `<ruby>` with one `<rt>` per character. The ruby is `aria-hidden` and an `sr-only` copy carries the plain name.
- A sheet rename (`patchContact`) clears the reading of the renamed person; the contact form saves whatever the field holds.

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
