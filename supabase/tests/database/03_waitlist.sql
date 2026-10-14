begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

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

select private.mark_waitlist_invite_sent('INVITED@example.test');
select ok(
  (select invite_sent_at is not null from private.waitlist where email = 'invited@example.test'),
  'invite send is recorded');

select is(
  (select array_agg(status order by status = 'approved', requested_at) from private.list_waitlist()),
  array['pending', 'approved', 'approved'],
  'list_waitlist puts pending requests first');

-- client roles cannot reach the waitlist
set local role authenticated;
select throws_ok(
  $$ select * from private.waitlist $$, '42501', null,
  'authenticated cannot read the waitlist');
select throws_ok(
  $$ select private.approve_waitlist_email('x@example.test') $$, '42501', null,
  'authenticated cannot approve emails');
reset role;

select * from finish();
rollback;
