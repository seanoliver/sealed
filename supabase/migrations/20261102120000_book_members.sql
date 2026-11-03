set lock_timeout = '5s';

-- RLS checks user_id only. The email is never used for authorization.

create table public.book_members (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  email extensions.citext not null check (char_length(email) <= 320),
  user_id uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  linked_at timestamptz
);
create unique index book_members_email_unique on public.book_members (email);
create unique index book_members_user_unique on public.book_members (user_id)
  where user_id is not null;
create index book_members_book_idx on public.book_members (book_id);
alter table public.book_members enable row level security;

-- Must not reference books: books_select_member reads this table, so it would recurse.
create policy "book_members_select_self" on public.book_members
  for select to authenticated using (user_id = (select auth.uid()));
grant select on public.book_members to authenticated;

-- SELECT only: book settings stay owner-only.
create policy "books_select_member" on public.books
  for select to authenticated
  using (exists (select 1 from public.book_members m
                 where m.book_id = books.id and m.user_id = (select auth.uid())));

drop policy "contacts_all_own_book" on public.contacts;
create policy "contacts_all_own_book" on public.contacts
  for all to authenticated
  using (exists (select 1 from public.books b
                 where b.id = book_id
                   and (b.owner_id = (select auth.uid())
                        or exists (select 1 from public.book_members m
                                   where m.book_id = b.id and m.user_id = (select auth.uid())))))
  with check (exists (select 1 from public.books b
                      where b.id = book_id
                        and (b.owner_id = (select auth.uid())
                             or exists (select 1 from public.book_members m
                                        where m.book_id = b.id and m.user_id = (select auth.uid())))));

drop policy "submissions_select_own_book" on public.submissions;
create policy "submissions_select_own_book" on public.submissions
  for select to authenticated
  using (exists (select 1 from public.books b
                 where b.id = book_id
                   and (b.owner_id = (select auth.uid())
                        or exists (select 1 from public.book_members m
                                   where m.book_id = b.id and m.user_id = (select auth.uid())))));

drop policy "submissions_update_own_book" on public.submissions;
create policy "submissions_update_own_book" on public.submissions
  for update to authenticated
  using (exists (select 1 from public.books b
                 where b.id = book_id
                   and (b.owner_id = (select auth.uid())
                        or exists (select 1 from public.book_members m
                                   where m.book_id = b.id and m.user_id = (select auth.uid())))))
  with check (exists (select 1 from public.books b
                      where b.id = book_id
                        and (b.owner_id = (select auth.uid())
                             or exists (select 1 from public.book_members m
                                        where m.book_id = b.id and m.user_id = (select auth.uid())))));

drop policy "submissions_delete_own_book" on public.submissions;
create policy "submissions_delete_own_book" on public.submissions
  for delete to authenticated
  using (exists (select 1 from public.books b
                 where b.id = book_id
                   and (b.owner_id = (select auth.uid())
                        or exists (select 1 from public.book_members m
                                   where m.book_id = b.id and m.user_id = (select auth.uid())))));

drop policy "email_sends_select_own_book" on public.email_sends;
create policy "email_sends_select_own_book" on public.email_sends
  for select to authenticated
  using (exists (select 1 from public.books b
                 where b.id = book_id
                   and (b.owner_id = (select auth.uid())
                        or exists (select 1 from public.book_members m
                                   where m.book_id = b.id and m.user_id = (select auth.uid())))));

drop policy "contact_events_select_own" on public.contact_events;
create policy "contact_events_select_own" on public.contact_events
  for select to authenticated
  using (exists (select 1 from public.contacts c
                 join public.books b on b.id = c.book_id
                 where c.id = contact_id
                   and (b.owner_id = (select auth.uid())
                        or exists (select 1 from public.book_members m
                                   where m.book_id = b.id and m.user_id = (select auth.uid())))));

-- App lookups pick one book per user, so a member who also owned one would
-- have saves land in either. Clients can insert books directly, not only via onboarding.
create or replace function private.books_reject_member_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.book_members m where m.user_id = new.owner_id) then
    raise exception 'a member of a shared address book cannot own another'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger books_reject_member_owner
  before insert or update of owner_id on public.books
  for each row execute function private.books_reject_member_owner();
