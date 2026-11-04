set lock_timeout = '5s';

-- Invite linking reads this column; app_server exists only in hosted environments.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_server') then
    grant select (email_confirmed_at) on auth.users to app_server;
  end if;
end $$;
