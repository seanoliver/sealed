-- /u/[token] reads and writes structured household names. The legacy
-- display-string keys still work; private.sync_contact_names keeps the two
-- forms consistent either way.

set lock_timeout = '5s';

create or replace function private.get_contact_for_token(p_token text)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'contact', jsonb_build_object(
      'full_name', c.full_name, 'partner_name', c.partner_name,
      'kids_names', c.kids_names,
      'first_name', c.first_name, 'last_name', c.last_name,
      'partner_first_name', c.partner_first_name,
      'partner_last_name', c.partner_last_name, 'kids', c.kids,
      'email', c.email, 'birthday', c.birthday,
      'address_line1', c.address_line1, 'address_line2', c.address_line2,
      'city', c.city, 'state_region', c.state_region,
      'postal_code', c.postal_code, 'country', c.country),
    'enabled_fields', b.enabled_fields,
    'owner_name', p.display_name)
  from public.update_tokens t
  join public.contacts c on c.id = t.contact_id
  join public.books b on b.id = c.book_id
  join public.profiles p on p.id = b.owner_id
  where t.token_hash = extensions.digest(p_token, 'sha256')
    and t.expires_at > now()
    and t.used_at is null
$$;

-- Structured keys, each gated like its display string:
--   first_name + last_name (both non-empty) replace the contact's own name;
--   partner_first_name / partner_last_name (partner_name enabled) replace the
--     partner, and an empty partner_first_name clears it;
--   kids (kids_names enabled) replaces the kids, and [] or null clears them.
-- Display strings are written alongside so a cleared group also clears its
-- string (the trigger alone only derives from a set group).
create or replace function private.apply_token_update(p_token text, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_contact_id uuid;
  v_enabled jsonb;
  v_before jsonb;
  v_first text;
  v_last text;
  v_partner boolean;
  v_partner_first text;
  v_partner_last text;
  v_kids_given boolean;
  v_kids jsonb;
begin
  -- untrusted input: refuse non-object or oversized payloads outright
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or pg_column_size(p_payload) > 65536 then
    return false;
  end if;

  select t.contact_id, b.enabled_fields
    into v_contact_id, v_enabled
  from public.update_tokens t
  join public.contacts c on c.id = t.contact_id
  join public.books b on b.id = c.book_id
  where t.token_hash = extensions.digest(p_token, 'sha256')
    and t.expires_at > now()
    and t.used_at is null
  for update of t;

  if v_contact_id is null then return false; end if;

  v_first := nullif(trim(p_payload ->> 'first_name'), '');
  v_last := nullif(trim(p_payload ->> 'last_name'), '');
  if v_first is null or v_last is null then
    v_first := null;
    v_last := null;
  end if;

  v_partner := coalesce((v_enabled ->> 'partner_name')::boolean, false)
    and (p_payload ? 'partner_first_name' or p_payload ? 'partner_last_name');
  v_partner_first := nullif(trim(p_payload ->> 'partner_first_name'), '');
  v_partner_last := case when v_partner_first is not null
                         then nullif(trim(p_payload ->> 'partner_last_name'), '') end;

  v_kids_given := coalesce((v_enabled ->> 'kids_names')::boolean, false)
    and p_payload ? 'kids';
  if v_kids_given and jsonb_typeof(p_payload -> 'kids') = 'array' then
    select jsonb_agg(
             case when nullif(trim(k ->> 'last'), '') is null
                  then jsonb_build_object('first', trim(k ->> 'first'))
                  else jsonb_build_object('first', trim(k ->> 'first'),
                                          'last', trim(k ->> 'last')) end
             order by n)
      into v_kids
    from jsonb_array_elements(p_payload -> 'kids') with ordinality e(k, n);
  elsif v_kids_given and jsonb_typeof(p_payload -> 'kids') <> 'null' then
    return false;
  end if;
  if v_kids is not null and not private.valid_kids(v_kids) then
    return false;
  end if;

  select to_jsonb(c) - 'created_at' - 'updated_at' into v_before
  from public.contacts c where c.id = v_contact_id;

  update public.contacts c set
    first_name   = coalesce(v_first, c.first_name),
    last_name    = coalesce(v_last, c.last_name),
    full_name    = case when v_first is not null then private.format_person(v_first, v_last)
                        else coalesce(nullif(trim(p_payload ->> 'full_name'), ''), c.full_name) end,
    email        = coalesce(nullif(trim(p_payload ->> 'email'), '')::extensions.citext, c.email),
    partner_first_name = case when v_partner then v_partner_first else c.partner_first_name end,
    partner_last_name  = case when v_partner then v_partner_last else c.partner_last_name end,
    partner_name = case when v_partner
                        then private.format_person(v_partner_first, v_partner_last)
                        when (v_enabled ->> 'partner_name')::boolean and p_payload ? 'partner_name'
                        then nullif(trim(p_payload ->> 'partner_name'), '') else c.partner_name end,
    kids         = case when v_kids_given then v_kids else c.kids end,
    kids_names   = case when v_kids_given
                        then private.format_kids(v_kids, coalesce(v_last, c.last_name))
                        when (v_enabled ->> 'kids_names')::boolean and p_payload ? 'kids_names'
                        then nullif(trim(p_payload ->> 'kids_names'), '') else c.kids_names end,
    birthday     = case when (v_enabled ->> 'birthday')::boolean and p_payload ? 'birthday'
                        then nullif(trim(p_payload ->> 'birthday'), '')::date else c.birthday end,
    address_line1 = case when p_payload ? 'address_line1' then nullif(trim(p_payload ->> 'address_line1'), '') else c.address_line1 end,
    address_line2 = case when p_payload ? 'address_line2' then nullif(trim(p_payload ->> 'address_line2'), '') else c.address_line2 end,
    city          = case when p_payload ? 'city' then nullif(trim(p_payload ->> 'city'), '') else c.city end,
    state_region  = case when p_payload ? 'state_region' then nullif(trim(p_payload ->> 'state_region'), '') else c.state_region end,
    postal_code   = case when p_payload ? 'postal_code' then nullif(trim(p_payload ->> 'postal_code'), '') else c.postal_code end,
    country       = case when p_payload ? 'country' then nullif(trim(p_payload ->> 'country'), '') else c.country end
  where c.id = v_contact_id;

  update public.update_tokens
    set used_at = now()
  where token_hash = extensions.digest(p_token, 'sha256');

  -- audit only keys this function can map: junk keys from the untrusted
  -- payload never reach storage
  insert into public.contact_events (contact_id, source, diff)
  values (v_contact_id, 'token', jsonb_build_object(
    'before', v_before,
    'payload', p_payload - array(
      select k from jsonb_object_keys(p_payload) k
      where k not in ('full_name', 'email', 'partner_name', 'kids_names', 'birthday',
                      'address_line1', 'address_line2', 'city', 'state_region',
                      'postal_code', 'country', 'first_name', 'last_name',
                      'partner_first_name', 'partner_last_name', 'kids'))));

  return true;
end $$;

revoke all on function private.get_contact_for_token(text) from public, anon, authenticated;
revoke all on function private.apply_token_update(text, jsonb) from public, anon, authenticated;
