set lock_timeout = '5s';

create table public.agent_previews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  agent_token_id uuid not null references public.agent_tokens (id) on delete cascade,
  kind text not null check (kind in ('delete', 'email')),
  items jsonb not null check (
    jsonb_typeof(items) = 'array'
    and jsonb_array_length(items) between 1 and 500
    and pg_column_size(items) <= 4194304
  ),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > created_at),
  requested_at timestamptz,
  applied_at timestamptz,
  discarded_at timestamptz,
  check (applied_at is null or discarded_at is null)
);
create index agent_previews_user_idx on public.agent_previews (user_id, created_at desc);
create index agent_previews_token_idx on public.agent_previews (agent_token_id);
alter table public.agent_previews enable row level security;

create policy "agent_previews_select_own" on public.agent_previews
  for select to authenticated using (user_id = (select auth.uid()));
create policy "agent_previews_resolve_own" on public.agent_previews
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and requested_at is not null and applied_at is null and discarded_at is null
  )
  with check (user_id = (select auth.uid()));
create policy "agent_previews_queue_email" on public.agent_previews
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and kind = 'email'
    and requested_at is not null and applied_at is null and discarded_at is null
    and exists (
      select 1 from public.agent_tokens t
      where t.id = agent_token_id and t.user_id = (select auth.uid()) and t.revoked_at is null)
  );
grant select on public.agent_previews to authenticated;
grant insert (user_id, agent_token_id, kind, items, expires_at, requested_at)
  on public.agent_previews to authenticated;
grant update (applied_at, discarded_at, items) on public.agent_previews to authenticated;

alter table public.contact_events drop constraint contact_events_source_check;
alter table public.contact_events
  add constraint contact_events_source_check
    check (source in ('owner', 'token', 'submission', 'agent')),
  -- Cascade, not set null: a user delete removes contacts in the same statement,
  -- and a set-null update on a doomed event fails its contact foreign key.
  add column agent_token_id uuid references public.agent_tokens (id) on delete cascade,
  -- No foreign key: finished requests are pruned after 30 days, and the
  -- events they produced must stay.
  add column agent_preview_id uuid,
  add column contact_updated_at timestamptz,
  add constraint contact_events_agent_check check (
    source = 'agent'
    or (agent_token_id is null and agent_preview_id is null and contact_updated_at is null)
  );
create index contact_events_agent_idx on public.contact_events (agent_token_id, created_at desc)
  where agent_token_id is not null;

-- Agent writes record their history in the same transaction as the contact
-- write, as the owner: only agent rows, with the owner's own live token, on a
-- contact in the owner's book, stamped with that contact's current updated_at.
create policy "contact_events_insert_agent" on public.contact_events
  for insert to authenticated
  with check (
    source = 'agent'
    and recipient is null
    and exists (
      select 1 from public.agent_tokens t
      where t.id = agent_token_id and t.user_id = (select auth.uid()) and t.revoked_at is null)
    and exists (
      select 1 from public.contacts c join public.books b on b.id = c.book_id
      where c.id = contact_id and b.owner_id = (select auth.uid())
        and c.updated_at = contact_updated_at)
  );
grant insert (contact_id, source, diff, agent_token_id, agent_preview_id, contact_updated_at)
  on public.contact_events to authenticated;
