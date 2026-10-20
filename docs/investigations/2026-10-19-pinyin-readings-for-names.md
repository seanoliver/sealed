# Pinyin readings for names in Chinese characters

- **Date:** 2026-10-19
- **Status:** Current
- **Prompted by:** Feature build
- **Last verified:** after the override removal on 2026-10-19
- **Related:** Issue #110, PR #113

## Question

How are owner-only pinyin readings generated, rendered and searched, and what keeps them away from recipients?

## Key findings

- Readings are generated at render time and never stored. Owner overrides were built and then removed before merge: keeping a stored reading in step with renames (token replies, merges, sheet edits, form re-saves) and placing it on the right characters cost more than it gave. Nothing in the schema, CSV, emails or `get_contact_for_token` carries pinyin.
- `pinyin-pro` 3.29.4 is server-only (`src/lib/pinyin.ts`). Its person-name mode is the `surname` option (`"off" | "all" | "head"`, in `types/core/pinyin/index.d.ts`); `mode: "surname"` is the older form and defaults to `all`. Surname mode applies only to the surname run: the last name of a split name (generated together with the first name, last name first), a single run holding a whole name, or the last run of an unsplit name stored given name first ("华 李" reads Huá Lǐ, not Huà).
- It is imported lazily and only when a name has Han characters. A failed import is logged (`[py] [contactReadings]`), not cached, and yields no readings, so names render without pinyin instead of the page failing.
- The client never loads pinyin-pro. The server builds a `Readings` map (Han run → syllables) per contact, and the client looks runs up in it (`src/lib/readings.ts`). A run the map lacks, such as a name typed into an open inline edit, renders as plain text.
- Search stays server-side: a pinyin-looking query also pulls rows whose names contain Han characters (Postgres regex), and `listContacts` filters them with `matchesReading`. It accepts stored order, Han runs reversed ("伟 张" by "zhang wei") and a single-run name given name first (张伟 by "wei zhang"), using capitals to find the surname.

## How it works

- `NameWithReading` renders `<ruby>` with one `<rt>` per character. The ruby is `aria-hidden` and an `sr-only` copy carries the plain name.
- Submitted names for Two answers and review cards come from `submittedPeople`, which keeps the payload's first and last names so generation can tell the surname apart.

## Gotchas

- Ruby inside a link changes its accessible name to "张 伟" (one word per base). Hence the `sr-only` copy.
- `rt` doesn't grow a fixed-height table row. The Name cell uses `has-[ruby]:py-1` and the wrapper raises `line-height`.
- Polyphonic given names can still read wrong (generation has no context beyond the name). There is no way to correct one; reintroducing overrides needs a rename-safe storage design first.

## References

- `src/lib/pinyin.ts`, `src/lib/readings.ts`, `src/components/name-with-reading.tsx`
- `src/lib/pinyin-load.test.ts`, `src/lib/queries/contacts-pinyin-load.test.ts`, `e2e/pinyin-names.spec.ts`
- `node_modules/pinyin-pro/README.md`, `node_modules/pinyin-pro/types/common/type.d.ts`
