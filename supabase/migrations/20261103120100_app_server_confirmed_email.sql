set lock_timeout = '5s';

-- Invite linking (src/lib/queries/books.ts) reads auth.users.email_confirmed_at.
-- Production's restricted app_server role only had (id, email), so the link
-- query failed there and members landed on onboarding. The role exists only
-- in hosted environments (docs/SECURITY.md, Database role).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_server') then
    grant select (email_confirmed_at) on auth.users to app_server;
  end if;
end $$;
