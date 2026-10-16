begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- Start from an empty waitlist; the rollback at the end restores it.
delete from private.waitlist;

-- before_user_created_hook: unknown emails are recorded and rejected
select is(
  private.before_user_created_hook(
    '{"user": {"email": "New@Example.test", "app_metadata": {"provider": "email"}}}'),
  '{"error": {"http_code": 403, "message": "sealed_waitlisted"}}'::jsonb,
  'unapproved email is rejected with the waitlist marker');
select results_eq(
  $$ select email, status, source from private.waitlist where email = 'new@example.test' $$,
  $$ values ('new@example.test', 'pending', 'email') $$,
  'unapproved email is recorded lowercased as pending');

select is(
  private.before_user_created_hook(
    '{"user": {"email": "g@example.test", "app_metadata": {"provider": "google"}}}')
    -> 'error' ->> 'message',
  'sealed_waitlisted',
  'unapproved Google sign-up is rejected');
select is(
  (select source from private.waitlist where email = 'g@example.test'),
  'google',
  'Google sign-up is recorded with its source');

select lives_ok(
  $$ select private.before_user_created_hook(
       '{"user": {"email": "new@example.test", "app_metadata": {"provider": "google"}}}') $$,
  'a repeat request does not fail');
select is(
  (select source from private.waitlist where email = 'new@example.test'),
  'email',
  'a repeat request keeps the original row');
select is(
  private.before_user_created_hook('{"user": {"email": "new@example.test"}}'),
  '{"error": {"http_code": 403, "message": "sealed_waitlisted"}}'::jsonb,
  'a pending email is still rejected on a repeat request');

select is(
  private.before_user_created_hook('{"user": {"phone": "+15555550100"}}') -> 'error' ->> 'message',
  'sealed_waitlisted',
  'a sign-up without an email is rejected');

-- approval
select ok(private.approve_waitlist_email('New@Example.test'), 'approving a pending email returns true');
select results_eq(
  $$ select status, approved_at is not null from private.waitlist where email = 'new@example.test' $$,
  $$ values ('approved', true) $$,
  'approval marks the row approved');
select ok(not private.approve_waitlist_email('new@example.test'), 'approving twice returns false');
select is(
  private.before_user_created_hook('{"user": {"email": "NEW@example.test"}}'),
  '{}'::jsonb,
  'approved email may sign up, in any case');

select ok(private.approve_waitlist_email(' invited@example.test '), 'an email can be approved before it asks');
select is(
  private.before_user_created_hook('{"user": {"email": "invited@example.test"}}'),
  '{}'::jsonb,
  'pre-approved email may sign up');

select private.mark_waitlist_invitation_sent('INVITED@example.test');
select ok(
  (select invitation_sent_at is not null from private.waitlist where email = 'invited@example.test'),
  'invite send is recorded');

-- list_waitlist: pending first, then by request time (no re-sorting here)
update private.waitlist set requested_at = now() - interval '3 days' where email = 'g@example.test';
update private.waitlist set requested_at = now() - interval '2 days' where email = 'new@example.test';
update private.waitlist set requested_at = now() - interval '1 day' where email = 'invited@example.test';
insert into private.waitlist (email, source, requested_at) values ('late@example.test', 'email', now());
select is(
  (select array_agg(email order by n) from private.list_waitlist() with ordinality as t(email, status, source, requested_at, approved_at, invitation_sent_at, n)),
  array['g@example.test', 'late@example.test', 'new@example.test', 'invited@example.test'],
  'list_waitlist returns pending oldest first, then approved oldest first');

-- Supabase Auth can run the hook; client roles reach nothing
select ok(has_schema_privilege('supabase_auth_admin', 'private', 'usage'),
  'supabase_auth_admin can use the private schema');
select ok(has_function_privilege('supabase_auth_admin', 'private.before_user_created_hook(jsonb)', 'execute'),
  'supabase_auth_admin can run the hook');
select ok((select prosecdef from pg_proc where oid = 'private.before_user_created_hook(jsonb)'::regprocedure),
  'the hook runs as its owner');
select ok(not has_function_privilege('supabase_auth_admin', 'private.approve_waitlist_email(text)', 'execute'),
  'supabase_auth_admin cannot approve emails');
select ok(not has_table_privilege('supabase_auth_admin', 'private.waitlist', 'select'),
  'supabase_auth_admin cannot read the waitlist directly');
select ok(not has_table_privilege('anon', 'private.waitlist', 'select')
          and not has_table_privilege('authenticated', 'private.waitlist', 'select,insert,update,delete'),
  'client roles have no table privileges on the waitlist');
select ok(not has_function_privilege('anon', 'private.before_user_created_hook(jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'private.before_user_created_hook(jsonb)', 'execute'),
  'client roles cannot run the hook');
select ok(not has_function_privilege('anon', 'private.approve_waitlist_email(text)', 'execute')
          and not has_function_privilege('authenticated', 'private.approve_waitlist_email(text)', 'execute'),
  'client roles cannot approve emails');
select ok(not has_function_privilege('anon', 'private.list_waitlist()', 'execute')
          and not has_function_privilege('authenticated', 'private.list_waitlist()', 'execute'),
  'client roles cannot list the waitlist');
select ok(not has_function_privilege('anon', 'private.mark_waitlist_invitation_sent(text)', 'execute')
          and not has_function_privilege('authenticated', 'private.mark_waitlist_invitation_sent(text)', 'execute'),
  'client roles cannot mark invitations sent');

-- passwords never persist
insert into auth.users (id, email, encrypted_password)
values ('00000000-0000-0000-0000-0000000000e1', 'pw@example.test', 'attacker-hash');
select is((select encrypted_password from auth.users where email = 'pw@example.test'), '',
  'a password set at sign-up is stripped');
update auth.users set encrypted_password = 'attacker-hash' where email = 'pw@example.test';
select is((select encrypted_password from auth.users where email = 'pw@example.test'), '',
  'a password set later is stripped');

select * from finish();
rollback;
