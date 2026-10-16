# useTransition pending flag outlives updates made after await

**Date:** 2026-10-14
**Status:** Fixed
**Severity:** Minor
**Last verified:** PR #54 on 2026-10-14
**Related:** [PR #54](https://github.com/seanoliver/sealed/pull/54), [#51](https://github.com/seanoliver/sealed/issues/51)

## Symptom

In the contact table, after an inline save failed ("Name is required"), pressing Esc did not cancel the edit. The e2e test `an invalid edit shows the error and stays in edit mode` passed locally three times and failed in CI, where the row stayed in edit mode with the error shown.

## Root cause

The save ran as `startSave(async () => { const res = await patchContact(...); setEditState({ error }) })`, and Esc was ignored while `isSaving` (the transition's pending flag) was true. In React 19, state updates made after an `await` inside `startTransition` are not part of the transition: they commit as soon as they are scheduled, while `isPending` stays true until the action finishes. So the error rendered while the row still counted as saving. On a slow machine, a key pressed in that window was dropped.

## Reproduction

Wrap an async action in `useTransition`, set visible state after its `await`, and read `isPending` in a handler triggered right after that state appears. On a fast machine the window is too short to hit by hand; CI hit it.

## Fix

`saveEdit` in `src/app/dashboard/contacts-table.tsx` tracks saving with `useState` plus a ref guard instead of `useTransition`. The flag is cleared in the same synchronous block that sets the error or ends the edit, so both changes commit together.

## Verification

`e2e/contacts-sheet.spec.ts` passed 11/11 three times locally after the change, and the PR's CI E2E job reruns it.

## Recurrence guardrail

A comment on the `isSaving` state names the trap. The e2e test asserts that Esc cancels right after a failed save. General rule: do not gate interaction on a transition's `isPending` when the visible outcome is set after an `await`; set and clear your own flag next to the outcome.

## Follow-ups

None.
