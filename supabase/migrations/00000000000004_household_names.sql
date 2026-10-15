-- Structured household names. full_name, partner_name, and kids_names stay
-- as display strings; private.sync_contact_names keeps each one derived from
-- its structured group. src/lib/names.ts mirrors the format functions, and
-- the parity fixture in supabase/tests/database/03_household_names.sql is
-- shared with src/lib/names.test.ts.

set lock_timeout = '5s';

create or replace function private.valid_kids(p_kids jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_kid jsonb;
begin
  if p_kids is null then return true; end if;
  if jsonb_typeof(p_kids) <> 'array'
     or jsonb_array_length(p_kids) not between 1 and 10
     or pg_column_size(p_kids) > 8192 then
    return false;
  end if;
  for v_kid in select value from jsonb_array_elements(p_kids) loop
    if jsonb_typeof(v_kid) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_kid) k where k not in ('first', 'last'))
       or jsonb_typeof(v_kid -> 'first') is distinct from 'string'
       or char_length(v_kid ->> 'first') not between 1 and 80
       or (v_kid ? 'last' and (jsonb_typeof(v_kid -> 'last') <> 'string'
                               or char_length(v_kid ->> 'last') not between 1 and 80)) then
      return false;
    end if;
  end loop;
  return true;
end $$;

alter table public.contacts
  add column first_name text check (char_length(first_name) between 1 and 80),
  add column last_name text check (char_length(last_name) between 1 and 80),
  add column partner_first_name text check (char_length(partner_first_name) between 1 and 80),
  add column partner_last_name text check (char_length(partner_last_name) between 1 and 80),
  add column kids jsonb constraint contacts_kids_check check (private.valid_kids(kids));

alter table public.contacts drop constraint contacts_kids_names_check;
alter table public.contacts add constraint contacts_kids_names_check
  check (char_length(kids_names) <= 2000);

-- "First Last", skipping absent parts; null when both are absent.
create or replace function private.format_person(p_first text, p_last text)
returns text language sql immutable set search_path = '' as $$
  select nullif(concat_ws(' ', nullif(p_first, ''), nullif(p_last, '')), '')
$$;

-- Kids who share p_family_last (or have no last name) appear by first name
-- only; everyone else by full name. Joined with ", " in array order.
create or replace function private.format_kids(p_kids jsonb, p_family_last text)
returns text language sql immutable set search_path = '' as $$
  select nullif(string_agg(
    case when nullif(k.value ->> 'last', '') is null
              or k.value ->> 'last' = p_family_last
         then k.value ->> 'first'
         else private.format_person(k.value ->> 'first', k.value ->> 'last') end,
    ', ' order by k.ordinality), '')
  from jsonb_array_elements(coalesce(p_kids, '[]'::jsonb)) with ordinality k
$$;

-- Per group: a write that changes the display string but not the structured
-- group clears the group; otherwise a set group overwrites the display string.
-- SECURITY DEFINER: client roles have no USAGE on schema private, so the
-- calls to private.format_* would fail for an RLS-scoped writer.
create or replace function private.sync_contact_names()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and (new.first_name, new.last_name) is not distinct from (old.first_name, old.last_name)
     and new.full_name is distinct from old.full_name then
    new.first_name := null;
    new.last_name := null;
  elsif new.first_name is not null or new.last_name is not null then
    new.full_name := private.format_person(new.first_name, new.last_name);
  end if;

  if tg_op = 'UPDATE'
     and (new.partner_first_name, new.partner_last_name)
         is not distinct from (old.partner_first_name, old.partner_last_name)
     and new.partner_name is distinct from old.partner_name then
    new.partner_first_name := null;
    new.partner_last_name := null;
  elsif new.partner_first_name is not null or new.partner_last_name is not null then
    new.partner_name := private.format_person(new.partner_first_name, new.partner_last_name);
  end if;

  if tg_op = 'UPDATE'
     and new.kids is not distinct from old.kids
     and new.kids_names is distinct from old.kids_names then
    new.kids := null;
  elsif new.kids is not null then
    new.kids_names := private.format_kids(new.kids, new.last_name);
  end if;

  return new;
end $$;

create trigger contacts_sync_names
  before insert or update on public.contacts
  for each row execute function private.sync_contact_names();

-- The kids CHECK runs as the writing role, which needs EXECUTE (but no
-- schema USAGE) on valid_kids.
revoke all on function private.valid_kids(jsonb) from public, anon;
grant execute on function private.valid_kids(jsonb) to authenticated;
revoke all on function private.format_person(text, text) from public, anon, authenticated;
revoke all on function private.format_kids(jsonb, text) from public, anon, authenticated;
revoke all on function private.sync_contact_names() from public, anon, authenticated;
