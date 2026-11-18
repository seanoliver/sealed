# A save that fails on the network crashes the contact page

**Date:** 2026-11-18
**Status:** Fixed
**Severity:** Important
**Last verified:** fix PR for [#159](https://github.com/seanoliver/sealed/issues/159) on 2026-11-18
**Related:** [#159](https://github.com/seanoliver/sealed/issues/159), [#151](https://github.com/seanoliver/sealed/pull/151), [#179](https://github.com/seanoliver/sealed/pull/179)

## Symptom

On a bad connection, tapping Save (or "Save and go back", or Add contact) on the owner's contact page showed Next's default error screen. Every unsaved edit was lost, with no message.

## Root cause

`ContactEditor` passed the server action straight to `useActionState`. When the action's request fails, the promise rejects and React sends the rejection to the nearest error boundary. `/dashboard` has no `error.tsx`, so the whole page was replaced. The recipient confirm page already caught this case; the owner page never did, in the old `ContactForm` or the envelope editor that replaced it.

## Reproduction

In Playwright, `page.route()` the contact page URL and `abort()` POST requests, edit a field, and tap Save.

## Fix

`src/app/dashboard/contacts/[id]/contact-editor.tsx` wraps the action. A thrown error becomes `{ error: "The connection dropped. Tap again." }` with `values` read from the submitted form data, so React's reset after the action restores what was typed. The names on the envelope live in the editor's own state and are not reset. `unstable_rethrow` passes Next's own errors through, including the redirect that ends `createContact`. The message depends on the error: a network `TypeError` (or the browser being offline) gets the connection message, an action the server no longer knows (a tab open across a deploy) gets "This page is out of date. Copy anything you need, then reload.", and anything else gets the generic error.

A lost response is safe to retry, with any edits made in between. The editor sends a `save_token` with each save attempt and reuses it after a network failure. The token becomes a new contact's id, and every owner save stores it in `contacts.last_save_token`. A retry whose token matches is treated as the same save: on the add page it applies the newer values to the contact the first attempt created, and on an existing contact it is accepted despite the stale version. A trigger clears the token on any write that doesn't set a new one, so an agent's or recipient's edit in between still produces the usual conflict. A retry clears its own token first (`releaseSaveToken`) and then writes it with the change, so a second lost response in a row can still be retried. A successful save starts a new token.

## Verification

Two e2e tests in `e2e/contact-envelope.spec.ts` abort the save request, once on an existing contact and once on the add page. Both fail on the unfixed editor and pass with the fix, and the add-page test then adds the contact and lands on `/dashboard?added=`. Three more cover a lost response on save and on add (one contact, newer values applied, no false conflict), a stale action and a server 500. `actions.test.ts` covers the token at the action level, including another writer in between and another book's id, and `supabase/tests/database/14_contact_save_token.sql` covers the trigger.

## Recurrence guardrail

Those two tests. Any `useActionState` call that wraps a server action and can be used offline should catch the rejection the same way.

## Follow-ups

`/dashboard` still has no `error.tsx` backstop for other unexpected errors.
