set lock_timeout = '5s';

create or replace function private.revoke_links_on_email_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.update_tokens
  where contact_id = new.id and used_at is null;
  return new;
end $$;

revoke all on function private.revoke_links_on_email_change() from public, anon, authenticated;

create trigger contacts_revoke_links_on_email_change
  after update of email on public.contacts
  for each row
  when (old.email is distinct from new.email)
  execute function private.revoke_links_on_email_change();
