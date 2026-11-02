# A one-click confirm shows as "Updated"

**Date:** 2026-11-01
**Status:** Fixed
**Severity:** Important
**Last verified:** branch `fix/confirm-status` on 2026-11-01
**Related:** #80 (Oct 31 launch: import, address emails, recipient updates)

## Symptom

A recipient who tapped "Yes, send it here" on the confirm page showed the green **Updated** chip on the dashboard, the same chip as a recipient who changed their address. Before printing, the owner could not tell "address unchanged, confirmed" from "address changed".

Found on a full walk of the launch flow: Maya confirmed in one click, while Priya and Elena edited their addresses, and all three showed **Updated**.

## Root cause

`confirmTokenAddress` spends the token through `private.apply_token_reply` with an empty payload. The function records a `contact_events` row with `source = 'token'` and `diff = {before, after, payload}`, where `before = after`.

The dashboard's `updatedAfterSend` (in `listContacts`, and in the agent `getContact`) asked only whether a token event was newer than the latest send. It never looked at the diff, so any reply counted as an update. `apply_token_reply` already treated `before = after` as a no-op in its own conflict check, but the read side never used that test.

## Reproduction

1. Import a contact with an address and send the address request.
2. Open `/u/<token>/confirm` and tap "Yes, send it here".
3. The dashboard shows **Updated** for that contact.

## Fix

- `src/lib/queries/contacts.ts`: `listContacts` also returns `changedAfterSend`, which is true when a token reply after the send has no `after` (an older event) or has `before` distinct from `after`.
- `src/lib/contacts-sheet.ts`: `StatusKey` gains `"confirmed"`. `effectiveSends` returns `"confirmed"` when every reply was a no-op and `"updated"` when one changed something. `isNoOpReply(diff)` is the JS copy of the same test.
- `src/lib/agent/read.ts`: `getContact` uses `isNoOpReply`. Agents can filter by `status: "confirmed"`, and `book_summary` counts it.
- `src/app/dashboard/contacts-table.tsx`: a green **Confirmed** chip.

## Verification

- Unit tests: `toSheetRow` returns `confirmed` for a no-op reply, and `isNoOpReply` covers equal, changed and legacy diffs.
- DB tests: `listContacts` returns `changedAfterSend: false` for a no-op event, and agent `getContact` and `searchContacts({status: "confirmed"})` return the confirmed contact.
- A local database check confirmed that a real one-click confirm event has `diff->'before' = diff->'after'`.
- Re-ran the full flow walkthrough locally. Maya shows **Confirmed**, and Priya and Elena show **Updated**.

## Recurrence guardrail

The SQL and JS no-op tests sit next to each other with cross-referencing comments. The DB test and the agent test each seed a `before = after` event, so if either side stops telling a confirm apart from a change, a test fails.

## Follow-ups

None.
