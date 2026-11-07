set lock_timeout = '5s';

-- Pairs an owner marked as not duplicates. Detected duplicates themselves are
-- computed from names on read (src/lib/household-match.ts), so only this
-- decision is stored. contact_a < contact_b keeps one row per pair.
create table public.contact_duplicate_dismissals (
  book_id uuid not null references public.books (id) on delete cascade,
  contact_a uuid not null references public.contacts (id) on delete cascade,
  contact_b uuid not null references public.contacts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contact_a, contact_b),
  check (contact_a < contact_b)
);
create index contact_duplicate_dismissals_book_idx on public.contact_duplicate_dismissals (book_id);
create index contact_duplicate_dismissals_contact_b_idx on public.contact_duplicate_dismissals (contact_b);
alter table public.contact_duplicate_dismissals enable row level security;

create policy "contact_duplicate_dismissals_select_own_book" on public.contact_duplicate_dismissals
  for select to authenticated
  using (exists (select 1 from public.books b
                 where b.id = book_id
                   and (b.owner_id = (select auth.uid())
                        or exists (select 1 from public.book_members m
                                   where m.book_id = b.id and m.user_id = (select auth.uid())))));

create policy "contact_duplicate_dismissals_insert_own_book" on public.contact_duplicate_dismissals
  for insert to authenticated
  with check (
    exists (select 1 from public.books b
            where b.id = book_id
              and (b.owner_id = (select auth.uid())
                   or exists (select 1 from public.book_members m
                              where m.book_id = b.id and m.user_id = (select auth.uid()))))
    and exists (select 1 from public.contacts c
                where c.id = contact_a and c.book_id = contact_duplicate_dismissals.book_id)
    and exists (select 1 from public.contacts c
                where c.id = contact_b and c.book_id = contact_duplicate_dismissals.book_id));

grant select, insert on public.contact_duplicate_dismissals to authenticated;

-- A merge deletes a contact, so its record must commit with the delete. The
-- app writes every other owner event after commit, through the admin connection.
create policy "contact_events_insert_merge" on public.contact_events
  for insert to authenticated
  with check (
    source = 'owner'
    and recipient is null
    and agent_token_id is null
    and diff ? 'merged_from'
    and exists (
      select 1 from public.contacts c join public.books b on b.id = c.book_id
      where c.id = contact_id
        and (b.owner_id = (select auth.uid())
             or exists (select 1 from public.book_members m
                        where m.book_id = b.id and m.user_id = (select auth.uid()))))
  );
