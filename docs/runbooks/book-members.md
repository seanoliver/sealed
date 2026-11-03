# Share an address book with a member

**Status:** Current
**Last verified:** local integration tests on 2026-11-02; production pending
**Owner:** Sean
**Related:** `supabase/migrations/20261102120000_book_members.sql`, `src/lib/queries/books.ts`, `src/lib/email/sender.ts`

## Purpose

Give a second person (a partner) their own login to the owner's address book. A member can add, edit and remove contacts, import, review replies and send address requests. Book settings (the owner name on emails, the public link, invite fields, sender country) and agent tokens stay owner-only; a member's Settings page says so, and creating an agent token returns an owner-only error.

Every address-request email signs with the **owner's** name, whoever presses send, and its Reply-To lists the owner's and every linked member's account email.

## Prerequisites

- The `book_members` migration is applied to production (the deploy workflow does this on merge).
- A Supabase Management API token (`SUPABASE_ACCESS_TOKEN`) with access to `ivwrvilpjhqhmlzwgyot`.
- The member's email address, exactly as they will sign in with it (for Google sign-in, their Google account email).
- The member must not already own a book: a person sees one book, and an owned book wins.
- Hosted Auth keeps `mailer_autoconfirm = false` and `mailer_secure_email_change_enabled = true` (both verified on 2026-11-03). Linking trusts `auth.users.email_confirmed_at`; with autoconfirm on, anyone could sign up or change their email to an invited address and claim the invite.
- Tell the member first: every address-request email lists the owner's and each member's sign-in email in Reply-To.

## Procedure

1. Add the membership **before** the member signs in, so their first sign-in lands in the shared book instead of onboarding:

   ```bash
   curl -fsS -X POST "https://api.supabase.com/v1/projects/ivwrvilpjhqhmlzwgyot/database/query" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
     -d "{\"query\": \"insert into public.book_members (book_id, email) select id, 'MEMBER@EXAMPLE.COM' from public.books where owner_id = (select id from auth.users where email = 'OWNER@EXAMPLE.COM') returning id\"}"
   ```

2. Let them in through the waitlist gate: at <https://sealed.page/admin/waitlist>, use **Send invitation** with the member's email ([waitlist runbook](waitlist.md)).
3. The member opens the invitation link. On that first request `getOwnBook` attaches the membership to their user id and they see the owner's contacts.

## Verification

```sql
select email, user_id is not null as linked, linked_at from public.book_members;
```

`linked` turns true after the member's first signed-in page load. Their Settings page shows "This address book is shared with you."

## Failure recovery

- **The member reached onboarding and created their own book.** The membership row stays unlinked: linking skips anyone who owns a book, and a linked member cannot create one (`books_reject_member_owner` trigger). Linking also requires a confirmed email, read from `auth.users`. Delete their empty book (`delete from public.books where owner_id = '<member user id>'`), and their next page load links the membership.
- **Remove a member:** `delete from public.book_members where email = '...'`. Access ends on their next request; RLS checks the row every time.

## References

- RLS policies: `supabase/migrations/20261102120000_book_members.sql`
- Tests: `src/lib/db/book-members.test.ts`, `src/lib/queries/books.test.ts`
