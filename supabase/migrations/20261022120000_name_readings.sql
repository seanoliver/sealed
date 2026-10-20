set lock_timeout = '5s';

-- Owner-only: never add these to get_contact_for_token or any recipient-facing query.
alter table public.contacts
  add column name_reading text
    constraint contacts_name_reading_check check (char_length(name_reading) between 1 and 200),
  add column partner_name_reading text
    constraint contacts_partner_name_reading_check
    check (char_length(partner_name_reading) between 1 and 200);

-- Every rename path drops the reading unless the same update writes a new one.
-- Named to fire after contacts_sync_names, which rebuilds the names first.
create function private.sync_contact_readings()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.full_name is distinct from old.full_name
     and new.name_reading is not distinct from old.name_reading then
    new.name_reading := null;
  end if;
  if new.partner_name is distinct from old.partner_name
     and new.partner_name_reading is not distinct from old.partner_name_reading then
    new.partner_name_reading := null;
  end if;
  return new;
end $$;

revoke all on function private.sync_contact_readings() from public, anon, authenticated;

create trigger contacts_sync_readings
  before update on public.contacts
  for each row execute function private.sync_contact_readings();
