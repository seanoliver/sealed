# Sharing the envelope editor between the recipient and owner pages

**Date:** 2026-11-06
**Status:** Current
**Prompted by:** Feature build
**Last verified:** `99a9528` plus this change on 2026-11-06
**Related:** Contact page envelope PR

## Question

What could the owner's contact page reuse from the recipient's envelope editor, and what had to stay separate?

## Key findings

- Line editing, ZIP checks, keyboard handling and the household draft do not depend on tokens or Turnstile. They moved to `src/components/envelope-card.tsx`.
- The save flows differ. The recipient chooses between confirm and save and ends on a saved screen. The owner stays on the page and posts through `updateContact` with a version. Each page keeps its own form and action.
- `NamesEditor` serves both, with `recipient="owner"` for owner wording and removal rules. Its hidden `HouseholdInputs` post the same keys as `HouseholdFields`, so `updateContact` did not change.
- Without a street, `formatEnvelope` returns null. Owners can keep partial addresses, so `AddressPreview.partial` gives owner envelopes rows for those lines. Recipient envelopes ignore it.

## How it works

`useEnvelopeEditing` owns which line is open and the household draft. `useFormChanges` compares the form with its first render, and `rebase()` resets that after an owner save. `AddressFields` calls a render function with `fields` and `preview`. `EnvelopeCard` renders `fields` inside the open line, or in a hidden wrapper when closed, so every address field still posts.

## Gotchas

- A closed line hides its field, so a validation error there is invisible. `revealPostcode` opens the line, or a temporary line when no row prints the postcode. A `kids` error opens the names line because it has no single person to point at.
- `requestSubmit()` fires no `submit` event when browser validation fails. Anything set before it must check `reportValidity()` first.
- `page.screenshot` adds `caret-color: transparent` to inputs. If it runs before hydration, React logs a hydration mismatch and the dev overlay shows "1 Issue". That comes from Playwright, not the app. Wait for hydration before capturing.

## Open questions

None.

## References

- `src/components/envelope-card.tsx`
- `src/app/dashboard/contacts/[id]/contact-editor.tsx`
- `src/app/u/[token]/confirm/envelope-editor.tsx`
