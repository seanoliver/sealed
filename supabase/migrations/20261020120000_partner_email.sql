set lock_timeout = '5s';

-- lower(): citext's = lives in extensions and may not resolve under the
-- search_path a migration or dump runs with.
alter table public.contacts
  add column partner_email extensions.citext
    constraint contacts_partner_email_check check (char_length(partner_email::text) <= 320),
  add constraint contacts_partner_email_differs
    check (lower(partner_email::text) <> lower(email::text));

alter table public.update_tokens add column recipient text not null default 'primary'
  constraint update_tokens_recipient_check check (recipient in ('primary', 'partner'));
alter table public.email_sends add column recipient text not null default 'primary'
  constraint email_sends_recipient_check check (recipient in ('primary', 'partner'));

alter table public.contact_events add column recipient text
  constraint contact_events_recipient_check
  check (recipient in ('primary', 'partner') and source = 'token' or recipient is null);
update public.contact_events set recipient = 'primary' where source = 'token';

drop trigger contacts_revoke_links_on_email_change on public.contacts;

create or replace function private.revoke_links_on_email_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.update_tokens
  where contact_id = new.id and used_at is null and recipient = tg_argv[0];
  return new;
end $$;

revoke all on function private.revoke_links_on_email_change() from public, anon, authenticated;

create trigger contacts_revoke_links_on_email_change
  after update of email on public.contacts
  for each row
  when (lower(old.email::text) is distinct from lower(new.email::text))
  execute function private.revoke_links_on_email_change('primary');

create trigger contacts_revoke_partner_links_on_email_change
  after update of partner_email on public.contacts
  for each row
  when (lower(old.partner_email::text) is distinct from lower(new.partner_email::text))
  execute function private.revoke_links_on_email_change('partner');

create or replace function private.get_contact_for_token(p_token text)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'contact', jsonb_build_object(
      'full_name', c.full_name, 'partner_name', c.partner_name,
      'kids_names', c.kids_names,
      'first_name', c.first_name, 'last_name', c.last_name,
      'partner_first_name', c.partner_first_name,
      'partner_last_name', c.partner_last_name, 'kids', c.kids,
      'email', case t.recipient when 'partner' then c.partner_email else c.email end,
      'birthday', c.birthday,
      'address_line1', c.address_line1, 'address_line2', c.address_line2,
      'city', c.city, 'state_region', c.state_region,
      'postal_code', c.postal_code, 'country', c.country),
    'enabled_fields', b.enabled_fields,
    'owner_name', p.display_name,
    'recipient', t.recipient,
    'updated_at', c.updated_at)
  from public.update_tokens t
  join public.contacts c on c.id = t.contact_id
  join public.books b on b.id = c.book_id
  join public.profiles p on p.id = b.owner_id
  where t.token_hash = extensions.digest(p_token, 'sha256')
    and t.expires_at > now()
    and t.used_at is null
$$;

drop function private.apply_token_update(text, jsonb);

create function private.apply_token_update(
  p_token text, p_payload jsonb, p_seen_at timestamptz default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_contact_id uuid;
  v_book_id uuid;
  v_recipient text;
  v_enabled jsonb;
  v_before jsonb;
  v_after jsonb;
  v_updated_at timestamptz;
  v_conflict boolean;
  v_audited jsonb;
  v_email extensions.citext;
  v_first text;
  v_last text;
  v_partner boolean;
  v_partner_first text;
  v_partner_last text;
  v_kids_given boolean;
  v_kids jsonb;
begin
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or pg_column_size(p_payload) > 65536 then
    return null;
  end if;

  select t.contact_id, t.recipient, c.book_id, b.enabled_fields
    into v_contact_id, v_recipient, v_book_id, v_enabled
  from public.update_tokens t
  join public.contacts c on c.id = t.contact_id
  join public.books b on b.id = c.book_id
  where t.token_hash = extensions.digest(p_token, 'sha256')
    and t.expires_at > now()
    and t.used_at is null
  for update of t;

  if v_contact_id is null then return null; end if;

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
    return null;
  end if;
  if v_kids is not null and not private.valid_kids(v_kids) then
    return null;
  end if;

  -- The row lock makes a concurrent reply from the other person wait here,
  -- then see their change.
  select to_jsonb(c) - 'created_at' - 'updated_at', c.updated_at
    into v_before, v_updated_at
  from public.contacts c where c.id = v_contact_id
  for update;

  if p_seen_at is not null and v_updated_at > p_seen_at then
    select e.source = 'token' and e.recipient is distinct from v_recipient
      into v_conflict
    from public.contact_events e
    where e.contact_id = v_contact_id and e.created_at > p_seen_at
    order by e.created_at desc
    limit 1;
  end if;
  v_conflict := coalesce(v_conflict, false);

  -- Dropped, not saved: an email equal to the other person's trips
  -- contacts_partner_email_differs and fails the whole reply.
  v_email := nullif(trim(p_payload ->> 'email'), '')::extensions.citext;
  if lower(v_email::text) = lower(case v_recipient when 'partner' then v_before ->> 'email'
                                                   else v_before ->> 'partner_email' end) then
    v_email := null;
  end if;

  -- On a conflict the update only measures what would change: SL001 rolls it
  -- back, triggers included.
  begin
    -- Write the display strings too: the trigger never clears one when its
    -- partner or kids group is removed.
    update public.contacts c set
      first_name   = coalesce(v_first, c.first_name),
      last_name    = coalesce(v_last, c.last_name),
      full_name    = case when v_first is not null then private.format_person(v_first, v_last)
                          else coalesce(nullif(trim(p_payload ->> 'full_name'), ''), c.full_name) end,
      email         = case when v_recipient = 'primary' then coalesce(v_email, c.email) else c.email end,
      partner_email = case when v_recipient = 'partner' then coalesce(v_email, c.partner_email)
                           else c.partner_email end,
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

    if v_conflict then
      select to_jsonb(c) - 'created_at' - 'updated_at' into v_after
      from public.contacts c where c.id = v_contact_id;
      raise exception using errcode = 'SL001';
    end if;
  exception when sqlstate 'SL001' then
    null;
  end;

  update public.update_tokens
    set used_at = now()
  where token_hash = extensions.digest(p_token, 'sha256');

  v_audited := p_payload - array(
    select k from jsonb_object_keys(p_payload) k
    where k not in ('full_name', 'email', 'partner_name', 'kids_names', 'birthday',
                    'address_line1', 'address_line2', 'city', 'state_region',
                    'postal_code', 'country', 'first_name', 'last_name',
                    'partner_first_name', 'partner_last_name', 'kids'));

  if v_conflict and v_after is distinct from v_before then
    insert into public.submissions (book_id, payload, matched_contact_id)
    select v_book_id,
           coalesce(jsonb_object_agg(
             case when k = 'email' and v_recipient = 'partner' then 'partner_email' else k end, v),
             '{}'::jsonb),
           v_contact_id
    from jsonb_each(v_audited) e(k, v)
    where v not in ('""'::jsonb, '[]'::jsonb, 'null'::jsonb);
    return 'queued';
  end if;

  insert into public.contact_events (contact_id, source, recipient, diff)
  values (v_contact_id, 'token', v_recipient,
          jsonb_build_object('before', v_before, 'payload', v_audited));

  return 'applied';
end $$;

revoke all on function private.get_contact_for_token(text) from public, anon, authenticated;
revoke all on function private.apply_token_update(text, jsonb, timestamptz) from public, anon, authenticated;
