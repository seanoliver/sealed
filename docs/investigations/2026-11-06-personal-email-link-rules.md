# Personal emails and the link rules

**Date:** 2026-11-06
**Status:** Current
**Prompted by:** Feature build
**Last verified:** branch `personal-email` on 2026-11-06, against `supabase/tests/database/13_personal_email.sql`
**Related:** [Partner replies and collisions](2026-10-19-partner-replies-and-collisions.md), [SECURITY.md](../SECURITY.md)

## Question

How can a recipient give a personal email without breaking the link they are using or tripping duplicate handling? A contact had one email plus a partner email. Changing `email` deletes that person's links, so writing the personal address there would kill the link in use, and it could also hit `contacts_book_email_unique` on a recipient's reply.

## Key findings

- `personal_email` and `partner_personal_email` are separate columns. A reply writes the one belonging to the link's person, through the payload key `personal_email`. There is no payload key for the other person's.
- The revoke triggers fire on `update of email` and `update of partner_email`, so adding a personal column changes nothing about existing links unless a trigger is added for it.
- `email_kind` and `partner_email_kind` hold the owner's override. Null means detect from the domain (`src/lib/email-kind.ts`). A trigger resets a kind when its address changes, because the override described the old address.

## How it works

| Change | Links |
|---|---|
| First personal email, by anyone | All stay. No address lost access |
| Recipient changes or clears theirs | That person's other links are deleted; the link they used stays |
| Owner or agent changes or clears one | All of that person's links are deleted |
| Next request reaches the personal address | Earlier links for that person are deleted, the work link included |

Invite address is `personal_email ?? email`, per person (`inviteAddresses`). A couple resolving to one inbox gets one email, to the primary.

Duplicates:

- `contacts_book_email_unique` is never at risk, because nothing writes a personal address into `email`.
- The personal columns have no unique index. A recipient must get the same outcome whether or not an address is in the book, so `apply_token_reply` stores it.
- Owner and agent writes refuse an address another contact uses (`personalEmailConflict`). Review approvals follow the reply rule and skip this check.
- `submit_to_book` matches `email` and `personal_email`, with an exact `email` match winning. It skips `partner_personal_email`, because a match merges into the primary. The public form can't set a personal address: the action drops the key and approval ignores it on permalink rows.
- CSV import skips a row whose email is someone's personal email.
- Two contacts can share an invite address. Each gets an email, because each envelope differs and skipping one would leave a contact with no link.

## Gotchas

- `apply_token_reply` drops, without saving, a personal email equal to the person's own email, the other person's email, or the other person's personal email. Review approval applies the same rule in `mergeUpdate`.
- An agent's change to a personal email waits for the owner, like `email` (`EMAIL_FIELDS`). A kind does not, because it only decides whether the page asks.
- An agent's or owner's change to `email` while a personal email is on file still revokes links, though invites keep going to the personal address.
- `email_kind` and `partner_email_kind` are not in the CSV export, because they are overrides, not contact data.
- Detection is a domain list, so someone on their own domain counts as work until the owner marks them. The question is optional, so the cost of a wrong guess is one extra field.

## Open questions

None.

## References

- `supabase/migrations/20261106130000_personal_email.sql`
- `src/lib/recipients.ts`, `src/lib/email-kind.ts`, `src/app/u/[token]/token-data.ts`
- `src/app/dashboard/contacts/write.ts`
