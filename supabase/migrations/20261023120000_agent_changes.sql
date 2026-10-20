set lock_timeout = '5s';

create table public.agent_previews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  agent_token_id uuid not null references public.agent_tokens (id) on delete cascade,
  kind text not null check (kind in ('update', 'delete')),
  items jsonb not null check (
    jsonb_typeof(items) = 'array'
    and jsonb_array_length(items) between 1 and 500
    and pg_column_size(items) <= 4194304
  ),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > created_at),
  requested_at timestamptz check (requested_at is null or kind = 'delete'),
  applied_at timestamptz,
  discarded_at timestamptz,
  check (applied_at is null or discarded_at is null)
);
create index agent_previews_user_idx on public.agent_previews (user_id, created_at desc);
create index agent_previews_token_idx on public.agent_previews (agent_token_id);
alter table public.agent_previews enable row level security;

create policy "agent_previews_select_own" on public.agent_previews
  for select to authenticated using (user_id = (select auth.uid()));
grant select on public.agent_previews to authenticated;

alter table public.contact_events drop constraint contact_events_source_check;
alter table public.contact_events
  add constraint contact_events_source_check
    check (source in ('owner', 'token', 'submission', 'agent')),
  -- Cascade, not set null: a user delete removes contacts in the same statement,
  -- and a set-null update on a doomed event fails its contact foreign key.
  add column agent_token_id uuid references public.agent_tokens (id) on delete cascade,
  -- No foreign key: applied previews are pruned after 30 days, and the id
  -- must keep grouping a bulk apply's events.
  add column agent_preview_id uuid,
  add column contact_updated_at timestamptz,
  add constraint contact_events_agent_check check (
    source = 'agent'
    or (agent_token_id is null and agent_preview_id is null and contact_updated_at is null)
  );
create index contact_events_agent_idx on public.contact_events (agent_token_id, created_at desc)
  where agent_token_id is not null;
create index contact_events_agent_preview_idx on public.contact_events (agent_preview_id)
  where agent_preview_id is not null;
