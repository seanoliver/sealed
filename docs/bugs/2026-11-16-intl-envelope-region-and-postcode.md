# UK and Dutch envelopes show the region on the street line and an unspaced postcode

**Date:** 2026-11-16
**Status:** Fixed
**Severity:** Minor
**Last verified:** branch `intl-envelope-region-postcode` on 2026-11-16
**Related:** #122 (per-country address formats), [libaddressinput investigation](../investigations/2026-10-20-libaddressinput-address-data.md)

## Symptom

The first batch of address-request emails (20 contacts, 2026-11-16) showed international addresses like this:

```
Flat 2, 14 Kestrel Lane, LONDON
BRISTOL
BS65QT
UNITED KINGDOM
```

and `Keizersgracht 212, FLEVOLAND` / `1016DZ Amsterdam` for a Dutch address. The region sat on the street line, and the postcode had no space. In the email's Georgia serif, a zero in an unspaced postcode can look like a lowercase o.

## Root cause

Two separate causes:

1. `formatEnvelope` (`src/lib/address/format.ts`) prints any stored value the country's format has no slot for beside the street, so it never silently disappears. That rule from #122 also caught `state_region` for countries whose format has no `%S` (GB, NL, ZA, GR, DE). Those countries don't use a region on mail, and the recipient form never shows a region field for them, so the value could only come from an import and the recipient had no way to remove it.
2. `normalizePostcode` spaces UK, Canadian, Irish and Dutch postcodes on write, but rows imported before that ran still held `BS65QT` and `1016DZ`. The formatter printed the stored value as is.

## Reproduction

```ts
envelopeLines(
  { addressLine1: "14 Kestrel Lane", addressLine2: null, district: null, city: "Bristol",
    stateRegion: "LONDON", postalCode: "BS65QT", countryCode: "GB" },
  { senderCountry: "US" },
);
// before: ["14 Kestrel Lane, LONDON", "BRISTOL", "BS65QT", "UNITED KINGDOM"]
```

## Fix

`src/lib/address/format.ts`:

- The slotless-value loop skips `S`. A region only prints where the format has `%S`. Slotless cities and districts (a Japanese city in `lfmt`, a Cayman or Nauru city) still print beside the street.
- `savedPostcode` runs `normalizePostcode` at display time for saved (upper-case) postcodes. A postcode still being typed keeps its case, so the editor's "the post capitalizes this" highlight keeps working.

Stored data is unchanged.

## Verification

- New tests in `src/lib/address/format.test.ts`: "leaves out a region when the country's format has no region line" and "spaces a postcode saved without its space". Both failed before the fix.
- Full suite against `origin/main` with local Supabase down: the same 159 database tests fail before and after; the change adds 2 passing tests and no failures. `tsc` and `eslint` are clean.
- Ran every non-US contact in the production book through the new formatter: UK addresses print `BRISTOL` / `BS6 5QT`, Dutch print `1016 DZ Amsterdam`, and the ZA and GR regions no longer print.

## Recurrence guardrail

The two tests above pin both behaviours. The comment on the slotless loop now says why a region is the exception.

## Follow-ups

- The investigation note says the form shows a slotless value "as an extra optional field". `addressFieldRows` only builds rows from format tokens, so that sentence looks stale; re-check before relying on it.
