set lock_timeout = '5s';

-- The owner editor's token for one save attempt. A retry after a lost response
-- carries the same token, so the server can tell its own earlier write apart
-- from someone else's. Any write that doesn't set a new token clears it.
alter table public.contacts add column last_save_token uuid;

create or replace function private.clear_contact_save_token()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.last_save_token is not distinct from old.last_save_token then
    new.last_save_token := null;
  end if;
  return new;
end $$;

create trigger contacts_clear_save_token before update on public.contacts
  for each row execute function private.clear_contact_save_token();
