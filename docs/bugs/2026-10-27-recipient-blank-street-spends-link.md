# Recipient form saves a blank street and spends the single-use link

**Date:** 2026-10-27
**Status:** Fixed
**Severity:** Important
**Last verified:** branch `fix/recipient-address-required` on 2026-10-27
**Related:** #126, #80 (production rehearsal)

## Symptom

In the production rehearsal, a contact with no address on file opened `/u/[token]`, switched the country to Canada, and the form submitted with every address field blank. The thanks page said "you're all set". The contact saved as "Canada" with no street, and the link then rendered "Link not available".

## Root cause

Nothing required an address on the recipient form. Every address column is optional in `contactSchema` (`src/lib/validation/contact.ts`), and `AddressFields` uses the per-country `required` flag only to decide which labels say "(optional)". It never set the `required` attribute. In `submitTokenUpdate` (`src/app/u/[token]/actions.ts`), step 5 sends a posted blank field as `""`, which clears the column. `apply_token_reply` then spends the single-use token. So an empty submit, or a recipient blanking a stored street, saves an address nobody can mail to, and the recipient cannot correct it.

## Reproduction

1. Seed a contact with an update token and no `address_line1`.
2. Open `/u/<token>` and submit without typing a street.
3. Before the fix: redirect to `/u/thanks`, street stays null, and the link is spent.

## Fix

- `submitTokenUpdate` refuses a posted blank `address_line1` before applying, with "<street label> is required to mail your card." The label comes from `fieldLabel` (`src/lib/address/fields.ts`), so it reads "Street and house number" for NL. The link is not spent.
- `AddressFields` takes a new `requireStreet` prop, which sets `required` on the street input. It is threaded through `RecipientForm` and `RecipientFields`, and only `/u/[token]/page.tsx` turns it on.
- The rule covers the street only. A first attempt enforced every per-country required field, and the e2e suite showed why that is wrong: legacy contacts keep the whole address in `address_line1` with city and postcode blank (`e2e/address-formats.spec.ts`, China case), and they must still save an unrelated name fix. The invite page (`/b/[slug]`) is unchanged, because its submissions go to review and spend no link.

## Verification

- New unit tests in `src/app/u/[token]/actions.test.ts`: "refuses a blank street address and keeps the link" (the link still works on the retry) and "names the street the way the country does".
- `e2e/token-update.spec.ts` checks that the browser holds a submit with a blank street and keeps the URL, then succeeds once a street is filled in.
- Full unit suite, `tsc --noEmit`, lint, and the full e2e suite. The only e2e failures were three waitlist specs, which fail the same way on `main`.

## Recurrence guardrail

The unit test fails if the action ever saves a blank posted street. The e2e test fails if the browser stops requiring the street. Test fixtures that submit the token form now seed a street, so a future fixture with a blank one shows up as a test failure, not a silent save.

## Follow-ups

- Labels promise more than the form enforces: city, state and postcode are not marked "(optional)" but are not required. Enforcing them needs a rule for legacy one-line addresses.
