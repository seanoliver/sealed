set lock_timeout = '5s';

-- Personal access tokens for agents (MCP). Like update_tokens, only the
-- sha256 of the raw token is stored. Rows are minted over the admin
-- connection; owners may list their tokens (never the hash) and revoke them.
create table public.agent_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  scopes text[] not null
    check (cardinality(scopes) > 0 and scopes <@ array['read', 'write', 'send']::text[]),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz check (expires_at > created_at),
  revoked_at timestamptz
);
create index agent_tokens_user_idx on public.agent_tokens (user_id, created_at desc);
alter table public.agent_tokens enable row level security;

create policy "agent_tokens_select_own" on public.agent_tokens
  for select to authenticated using (user_id = (select auth.uid()));
-- Revoke only: a revoked token can never be brought back.
create policy "agent_tokens_revoke_own" on public.agent_tokens
  for update to authenticated
  using (user_id = (select auth.uid()) and revoked_at is null)
  with check (user_id = (select auth.uid()) and revoked_at is not null);

-- Column grants keep token_hash unreadable and every other column immutable
-- for client roles; no insert or delete grant.
grant select (id, user_id, name, scopes, created_at, last_used_at, expires_at, revoked_at)
  on public.agent_tokens to authenticated;
grant update (revoked_at) on public.agent_tokens to authenticated;

-- Resolves a live token to its owner and records use at most once a minute.
create or replace function private.verify_agent_token(p_hash bytea)
returns table (token_id uuid, user_id uuid, scopes text[], expires_at timestamptz)
language sql security definer set search_path = '' as $$
  with hit as (
    select t.id, t.user_id, t.scopes, t.expires_at, t.last_used_at
    from public.agent_tokens t
    where t.token_hash = p_hash
      and t.revoked_at is null
      and (t.expires_at is null or t.expires_at > now())
  ), touched as (
    update public.agent_tokens t set last_used_at = now()
    from hit
    where t.id = hit.id
      and (hit.last_used_at is null or hit.last_used_at < now() - interval '1 minute')
  )
  select hit.id, hit.user_id, hit.scopes, hit.expires_at from hit
$$;

revoke all on function private.verify_agent_token(bytea) from public, anon, authenticated;
