# A delivery webhook that beats the send record is lost

**Date:** 2026-11-09
**Status:** Fixed
**Severity:** Important
**Last verified:** not yet; verify with the next volume run after deploy
**Related:** Issue #163 (pooler fix follow-ups), issue #80 (Oct 31 launch: import, address emails, recipient updates)

## Symptom

After a send, some contacts can stay at "Sent" for good even though Resend delivered the email. Nothing is logged, because the webhook answers 200.

## Root cause

`requestAddresses` (`src/app/dashboard/actions.ts`) sends every batch first and inserts the `email_sends` rows only after Resend accepts them, because the row is keyed on the `resend_id` that Resend returns. With several batches, or a slow insert, Resend's `email.delivered` webhook for an early email can arrive before its row exists. The webhook's update then matched 0 rows and returned 200, and Resend never retries a 200, so that status was lost.

## Reproduction

Post a signed `email.delivered` event for a `resend_id` that has no `email_sends` row yet, then insert the row. Before the fix the webhook answered 200 and the row stayed at "Sent".

## Fix

`src/app/api/webhooks/resend/route.ts` runs the precedence-guarded update and a check for whether a send with that `resend_id` exists in one SQL statement, so both see the same snapshot and a send recorded between two separate queries can't be missed. When the update matches no row: if no send exists and the event's `created_at` is under 10 minutes old, it answers 503, and Resend retries after 5 seconds and again after 5 minutes, by which time the row is there. An event blocked only by precedence (a late "delivered" after "opened"), an event older than 10 minutes, or one with no `created_at` still gets 200, so events from failed sends or other environments are never retried for long.

## Verification

`src/app/api/webhooks/resend/route.test.ts`: a recent event for an unrecorded send gets 503 and lands once the row exists; an old or undated event for an unknown id gets 200; a precedence-blocked event gets 200. Removing the 503, the existence check, or the 10-minute window each fails a test.

## Recurrence guardrail

The tests above. Anything that changes when `requestAddresses` records a send should keep an early webhook retryable.

## Follow-ups

Recording a pending send row before the batch call would remove the race instead of retrying around it, but the row is keyed on the id Resend returns.
