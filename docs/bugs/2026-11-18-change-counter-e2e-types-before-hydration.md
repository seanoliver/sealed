# Contact-page e2e types before hydration and blocks production deploys

**Date:** 2026-11-18
**Status:** Fixed
**Severity:** Important
**Last verified:** [#181](https://github.com/seanoliver/sealed/pull/181) on 2026-11-18
**Related:** [#179](https://github.com/seanoliver/sealed/pull/179), [#174](https://github.com/seanoliver/sealed/pull/174)

## Symptom

`e2e/contact-envelope.spec.ts` › "editing the partner's personal email doesn't mark the names line" failed on main CI for #174 and again for #179, with `getByText('1 change')` not found. It passed on both PRs' own CI runs. Because `Deploy production` only runs after a green main CI, production stayed on #162 for two merges.

## Root cause

`useFormChanges` (`src/components/envelope-card.tsx`) takes its baseline from the form in an effect that runs after hydration, and attaches its `input` listener in the same effect. The test filled `#partner_personal_email` straight after `page.goto`. On a slow runner the fill landed before hydration, so the typed value became part of the baseline and no listener saw the input. The page then reported no changes. Two other tests in the file ("Discard changes leaves without saving" and the modified-click test) fill the same way and had the same race; they had not run in the failed main runs because the spec is serial.

## Reproduction

Navigate with `waitUntil: "commit"` and fill the field at once. With no wait, the "1 change" counter never appears (5 of 5 local runs failed).

## Fix

- `useFormChanges` (`src/components/envelope-card.tsx`) sets `data-changes-ready` on its form once the baseline and listeners are in place, and removes it on cleanup.
- In `e2e/contact-envelope.spec.ts`, every visit to a contact page that then types waits for `form[data-changes-ready]` (`contactReady`, also called by `gotoContact`).

A first attempt waited for React's fiber key on the first `form`, plus two frames. Review showed both parts were wrong: React sets that key during the hydration render, before the commit and its effects, and the first `form` on the page is the header's sign-out form. Only a signal set by the effect itself is reliable.

## Verification

With `waitUntil: "commit"` navigation and the new wait, 10 of 10 local runs passed. Without the wait, 5 of 5 failed.

## Recurrence guardrail

Tests in `e2e/contact-envelope.spec.ts` call `contactReady` (directly or through `gotoContact`) before typing on a contact page. The comment on the attribute in `useFormChanges` says tests depend on it.

## Follow-ups

A real user who types before hydration gets the same result: no change count and no leave-without-saving prompt for that edit. The value still saves. Not fixed here.
