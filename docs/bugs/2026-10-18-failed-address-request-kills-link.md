# A failed address-request send left the contact with no working link

**Date:** 2026-10-18
**Status:** Fixed
**Severity:** Important
**Last verified:** branch `send-reliability` on 2026-10-18
**Related:** #80 (Oct 31 launch: import, address emails, recipient updates)

## Symptom

Found in a code read before launch, not seen in production. Three failure paths:

- A send that failed for a contact who already had a link left them with no live link.
- One address Resend rejected failed the whole batch of up to 100.
- A network error after Resend accepted a batch counted every email in it as failed.

## Root cause

`requestAddresses` (`src/app/dashboard/actions.ts`) deleted each contact's unused tokens and minted new ones before sending. After the send, it deleted the new tokens whose emails failed. A failed contact ended up with neither link.

`sendAddressRequests` (`src/lib/email/resend.ts`) used Resend's default strict batch validation, which rejects the whole batch for one bad email. It never retried, so the outcome of a request that dropped mid-flight was unknown.

## Reproduction

Send to a contact once. Then send again with Resend returning an error for that address. Before the fix, `update_tokens` had no unused row for the contact.

## Fix

- New tokens are inserted without touching old ones. After the send, one transaction records the `email_sends` rows and deletes the contact's older unused tokens. This runs only for confirmed sends, and only for tokens created before this request's mint, so a newer concurrent send keeps its link.
- Rejected emails delete their new token. Unconfirmed emails keep both links.
- Batches use `batchValidation: "permissive"` with a per-chunk `Idempotency-Key` (`<uuid>/<chunk>`). Network errors, 5xx, `rate_limit_exceeded` and `concurrent_idempotent_requests` retry with the same key. Quota errors fail immediately, because they are 429s too but won't clear on a retry.
- The result now includes `failedContactIds`.

## Verification

- `src/app/dashboard/actions.test.ts` runs `requestAddresses` against the local database. It covers the old link surviving a failed send, both links surviving an unconfirmed one, rotation after success, a newer concurrent send keeping its link, and RLS scoping. Removing the `createdAt` guard or the rejected-token delete fails these tests.
- `src/lib/email/resend.test.ts` covers chunking, permissive index mapping, retry rules and quota errors.
- The `contacts-sheet` and `token-update` e2e specs pass.

## Recurrence guardrail

The tests above. The permissive response shape (ids for accepted emails in request order, plus `errors[].index`) comes from the SDK types and Resend's changelog. A real response has not been checked yet. If the counts disagree, every unrejected email in the chunk is marked `unknown` and keeps both links, so a wrong guess about the shape never kills a link.

## Follow-ups

- Show which contacts failed in the send banner. This is UI work that needs design options. Tracked in #80.
- Check one permissive batch response against real Resend during the 5-address rehearsal.
