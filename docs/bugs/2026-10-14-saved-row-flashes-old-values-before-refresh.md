# Saved row flashes its old values before the refresh commits

**Date:** 2026-10-14
**Status:** Fixed
**Severity:** Minor
**Last verified:** PR #54 on 2026-10-14
**Related:** [PR #54](https://github.com/seanoliver/sealed/pull/54), [#51](https://github.com/seanoliver/sealed/issues/51), [useTransition pending flag entry](2026-10-14-react19-transition-pending-outlives-post-await-update.md)

## Symptom

After an inline save in the contact table, the row left edit mode showing the value from before the edit, then switched to the new value a moment later. Paris → London → Paris.

## Root cause

In Next 16.2.10, `server-action-reducer.js` calls `resolve(actionResult)` before it returns the router state that carries the revalidated page, and that state commits as a transition. The code after `await patchContact(...)` ran first and called `finishEdit`, an urgent update. React committed the read-only row with the stale `rows` prop, then committed the refreshed rows in a later render.

## Reproduction

Edit a cell, press Enter, and watch the row's DOM with a `MutationObserver`: the first commit after the inputs disappear contains the old value. Playwright's `toContainText` auto-waits, so it hides this.

## Fix

`src/app/dashboard/contacts-table.tsx`: on a successful save, `saveEdit` stores `{ id, values: patch, rows }` in `saved`. `ViewRow` gets `values` merged with the patch while `saved.rows === rows`. The first refreshed `rows` prop is a new array, so the overlay switches off by itself with no effect or cleanup.

## Verification

E2E test "a saved row shows the new value as soon as it leaves edit mode" in `e2e/contacts-sheet.spec.ts`. It fails without the fix (the observer records `London`) and passes with it.

## Recurrence guardrail

The e2e test above. General rule: state set after `await`ing a server action commits before the action's revalidated data. Anything rendered from props right after a save must bridge that gap.

## Follow-ups

None.
