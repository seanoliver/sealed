set lock_timeout = '5s';

create table private.waitlist (
  email text primary key check (email = lower(email)),
  status text not null default 'pending' check (status in ('pending', 'approved')),
  source text not null check (source in ('email', 'google')),
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  invite_sent_at timestamptz
);

-- The app matches the reject message (src/lib/waitlist.ts); change both together.
create or replace function private.before_user_created_hook(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(nullif(event -> 'user' ->> 'email', ''));
  v_provider text := event -> 'user' -> 'app_metadata' ->> 'provider';
  v_reject constant jsonb :=
    '{"error": {"http_code": 403, "message": "sealed_waitlisted"}}';
begin
  if v_email is null then
    return v_reject;
  end if;
  if exists (
    select 1 from private.waitlist where email = v_email and status = 'approved'
  ) then
    return '{}'::jsonb;
  end if;
  insert into private.waitlist (email, source)
  values (v_email, case when v_provider = 'google' then 'google' else 'email' end)
  on conflict (email) do nothing;
  return v_reject;
end $$;

create or replace function private.list_waitlist()
returns table (
  email text,
  status text,
  source text,
  requested_at timestamptz,
  approved_at timestamptz,
  invite_sent_at timestamptz
) language sql security definer set search_path = '' as $$
  select email, status, source, requested_at, approved_at, invite_sent_at
  from private.waitlist
  order by status = 'approved', requested_at;
$$;

-- Returns false if the email was already approved.
create or replace function private.approve_waitlist_email(p_email text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(trim(p_email));
begin
  insert into private.waitlist as w (email, status, source, approved_at)
  values (v_email, 'approved', 'email', now())
  on conflict (email) do update
    set status = 'approved', approved_at = now()
    where w.status = 'pending';
  return found;
end $$;

create or replace function private.mark_waitlist_invite_sent(p_email text)
returns void language sql security definer set search_path = '' as $$
  update private.waitlist set invite_sent_at = now() where email = lower(trim(p_email));
$$;

-- Sealed is passwordless. Without this, anyone could sign up with a password
-- for an approved email before its owner does, and keep access afterwards.
create or replace function private.strip_password()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.encrypted_password := '';
  return new;
end $$;

create trigger strip_password
  before insert or update of encrypted_password on auth.users
  for each row execute function private.strip_password();

revoke all on table private.waitlist from public, anon, authenticated;
revoke execute on function private.before_user_created_hook(jsonb) from public, anon, authenticated;
revoke execute on function private.list_waitlist() from public, anon, authenticated;
revoke execute on function private.approve_waitlist_email(text) from public, anon, authenticated;
revoke execute on function private.mark_waitlist_invite_sent(text) from public, anon, authenticated;
revoke execute on function private.strip_password() from public, anon, authenticated;

grant usage on schema private to supabase_auth_admin;
grant execute on function private.before_user_created_hook(jsonb) to supabase_auth_admin;
