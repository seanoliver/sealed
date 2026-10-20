# Google libaddressinput data for per-country addresses

- **Date:** 2026-10-20
- **Status:** Current
- **Prompted by:** Feature build
- **Last verified:** `feat/address-formats` on 2026-10-20
- **Related:** Issue #99

## Question

Where does Sealed get each country's address format, which parts of that data it uses, and what has to be true for a regenerated snapshot to keep working?

## Key findings

- The data is Google's libaddressinput metadata, the set Chrome autofill and Android use. Each country is one JSON document at `https://www.gstatic.com/chrome/autofill/libaddressinput/chromium-i18n/ssl-address/data/<CC>`. The country list comes from `https://chromium-i18n.appspot.com/ssl-address/data` (`countries`, `~`-separated, 252 codes on 2026-10-20). gstatic 404s for a few codes (KP); the appspot origin still serves them.
- A snapshot lives in `src/lib/address/data.json` (23,104 bytes, 6,225 gzipped). It stores only what differs from the `ZZ` defaults, so it is small enough to ship to the client; the country picker and form need it in the browser.
- Fields used: `fmt`, `lfmt`, `require`, `upper`, `zip` (one regex), the first `zipex`, `zip_name_type`, `state_name_type`, `locality_name_type`, `sublocality_name_type`, and `sub_keys`/`sub_names` for the US only. The country name is not the data's `name` (upper case and sometimes odd, such as "REP. OF SINGAPORE"); it is `Intl.DisplayNames("en")` with a few overrides for envelopes.
- Format tokens: `%N` name, `%O` organization (unused, always empty), `%A` street lines, `%D` district or suburb (stored in `contacts.district`), `%C` city, `%S` state or province, `%Z` postcode, `%n` new line. Other tokens (`%X`, `%T`, `%F`, `%L`) appear for a few countries and print nothing.

## How it works

- `scripts/generate-address-data.ts` fetches every country, compacts it and rewrites `data.json` (`pnpm exec tsx scripts/generate-address-data.ts`). It compiles each `zip` pattern as `^(?:…)$` and fails if JavaScript can't. `--sql` prints the `(key, code)` rows behind `private.country_code_for` in migration `20261024120000_address_formats.sql`.
- `src/lib/address/countries.ts` expands records (`getCountry`), lists countries for the picker and maps typed text to a code (`countryCodeFor`). Matching goes through `countryKey` in `aliases.ts`: lower case, accents and dots removed, NFC-composed (so Hangul stays whole), `&` read as "and", a leading "the" dropped. `countryKeyEntries` adds "St" for every "Saint". The SQL function mirrors this except accents, which it folds with a fixed `translate()` list; `apply_token_reply` uses it to refuse a code that names no country.
- `format.ts` renders an envelope: one format line at a time, separators kept only between printed fields, a leading literal ("〒", "SINGAPORE ") kept when its field prints. `upper` fields are capitalized at print time, never on save. The country line is the English name in capitals, left off when the code equals `books.sender_country`, and left off when the format's own fixed text prints the name (Singapore's "SINGAPORE %Z"). A street or state that happens to contain the name ("Canada Way", "Hong Kong Island") doesn't count.
- `fields.ts` turns a format into form rows: fields in format order, the postcode moved last when the format starts with it (China, Japan), labels from the name types, `require` for what is optional.
- `rules.ts` checks postcodes against `zip` and writes the error from `zipex` ("A Dutch postcode is four digits and two letters, like 1234 AB."), and normalizes UK, Canadian and Dutch spacing and US state names.

## Gotchas

- `fmt` vs `lfmt`: for CN, JP, KR, TW, HK, MO, KP, RU, UA, TH, VN, AE, EG and AM, `fmt` is the local-script order (postcode first and name last for China) and `lfmt` the Latin one. Sealed picks by script: any letter outside the Latin script in the street, district, city or state means `fmt`. The name's script doesn't count, so a Chinese address with a Latin name still prints in Chinese order. Local formats add a recipient suffix (收, 様, 귀하).
- `%A` is several lines in libaddressinput. Sealed joins line 1 and line 2 with ", " in Latin formats (line 2 first in GB, IE, AU and NZ: "Flat 2, 14 Kestrel Lane") and keeps them on separate lines in local scripts.
- A city that equals its state prints once only where the format runs them together (`%S%C`, China's municipalities such as 上海市). "New York, New York 10001" and "QUÉBEC QUÉBEC" print both.
- A stored value the chosen format has no slot for (a Japanese city in `lfmt`, a Cayman or Nauru city, a UK county) prints beside the street rather than vanishing, and the form shows it as an extra optional field until the country changes.
- The data's US `upper` is `CS`, which would print "PORTLAND, OR 97214". Sealed overrides it (`UPPER_OVERRIDES` in `countries.ts`) so US cities print as typed; the state is already a two-letter code. Other countries keep the data's rules, and the country line is always in capitals.
- `require` is shown as "(optional)" labels and never enforced on save. Contacts saved before #99 (all six China addresses sit in `address_line1`) must save without re-entry.
- The postcode check skips a postcode and country that match what is stored (compared after `normalizePostcode`), for the same reason. The forms post a field the layout hides only after the country changes in that session; an absent key leaves the stored value alone in `apply_token_reply` and the owner's save. A country change in the contacts table re-checks the stored postcode, so moving a UK contact to Ireland there is refused until the postcode fits.
- `Intl.DisplayNames` output depends on the Node ICU version that runs the script; review name changes in the diff when regenerating.
- Country text that no code matched stays in `contacts.country` and shows to the owner as unrecognized. Every write path (forms, table, agents, approvals, token replies) clears it when the country is set or cleared, and keeps it only while the country stays blank. It is part of the history snapshot (`country`), so undo brings it back. `rowAddress` ignores it once `country_code` is set. CSV import and pre-deploy submissions keep unmatched text there too.

## Open questions

- Postcode-specific checks beyond the regex (state-to-ZIP ranges from `sub_zips`) are not used.
- The data has subdivision lists for many countries (CA, AU, JP, CN); only the US uses a list in the form.

## References

- `src/lib/address/` (`countries.ts`, `aliases.ts`, `format.ts`, `fields.ts`, `rules.ts`, tests beside them)
- `scripts/generate-address-data.ts`
- `supabase/migrations/20261024120000_address_formats.sql`, `supabase/tests/database/10_address_formats.sql`
- `src/components/address-fields.tsx`, `src/components/country-picker.tsx`
- libaddressinput format reference: <https://github.com/google/libaddressinput/wiki/AddressValidationMetadata>
