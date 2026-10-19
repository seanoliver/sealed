# Recipients of legacy contacts could not save their address

**Date:** 2026-10-18
**Status:** Fixed
**Severity:** Important
**Last verified:** branch `token-form-legacy` on 2026-10-18
**Related:** #80 (Oct 31 launch: import, address emails, recipient updates), #78 (the owner-side fix)

## Symptom

Found in a code read, the recipient-side twin of #78. A recipient whose contact was imported with more than 10 kids, or a name part over 80 characters, saw "Add up to 10 children." or "Keep each name under 81 characters." when they submitted `/u/[token]`, even if they changed only their city. A contact named "Satya & Family" prefilled first name "Satya &" and last name "Family".

## Root cause

`submitTokenUpdate` (`src/app/u/[token]/actions.ts`) always validates the household it posts. For an unsplit legacy contact, the form posts the guessed split from `householdPrefill`, which can break the caps the stored strings never had. `naiveSplit` splits household labels on their last word.

## Reproduction

Seed a contact with `kids_names` listing 12 names and a live token in a book with kids enabled. Open `/u/<token>`, change the city, and submit.

## Fix

- `submitTokenUpdate` loads the token's contact when household validation fails. If the posted names equal the prefill exactly and that prefill breaks the caps (`exceedsCaps`), it saves only the details and leaves the stored names.
- `isUntouchedPrefill` takes the book's enabled sections, so the comparison matches what the page rendered.
- `isHouseholdLabel` (`src/lib/names.ts`) detects names like "Satya & Family", "Satya's Parents" and "The Smiths". These prefill as one first name, so the recipient is asked for a last name and can correct both.

## Verification

- `src/app/u/[token]/actions.test.ts` runs `submitTokenUpdate` against the local database: a normal save, a 12-kid contact, a long name part, an edited name still hitting the cap, a household label asked for a last name, bad details, and rate-limit and bot-check refusals. Removing the `exceedsCaps` condition or the keep-names branch fails these tests.
- Unit tests for `isHouseholdLabel`, `exceedsCaps` and the section-aware `isUntouchedPrefill`.

## Recurrence guardrail

The tests above. Any new form that posts a prefilled household must compare against `householdPrefill` with the same sections the page rendered.
