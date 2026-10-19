begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'tokennames@test.dev');
update public.profiles set display_name = 'Dana D' where id = '00000000-0000-0000-0000-0000000000d1';
insert into public.books (id, owner_id, slug, enabled_fields) values
  ('10000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', 'token-names-book',
   '{"partner_name": true, "kids_names": true, "birthday": false}');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d2', 'tokennames2@test.dev');
insert into public.books (id, owner_id, slug, enabled_fields) values
  ('10000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d2', 'token-names-off',
   '{"partner_name": false, "kids_names": false, "birthday": false}');

insert into public.contacts (id, book_id, full_name, partner_name, kids_names) values
  ('20000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1',
   'Jen Holloway', 'Mark', 'Zoe, Max');
insert into public.contacts (id, book_id, full_name, first_name, last_name,
  partner_first_name, partner_last_name, kids) values
  ('20000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-0000000000d2',
   'x', 'Priya', 'Raman', 'Daniel', 'Okafor', '[{"first": "Asha"}]');

insert into public.update_tokens (contact_id, token_hash, expires_at) values
  ('20000000-0000-0000-0000-0000000000d1', extensions.digest('tn1', 'sha256'), now() + interval '1 day'),
  ('20000000-0000-0000-0000-0000000000d1', extensions.digest('tn2', 'sha256'), now() + interval '1 day'),
  ('20000000-0000-0000-0000-0000000000d1', extensions.digest('tn3', 'sha256'), now() + interval '1 day'),
  ('20000000-0000-0000-0000-0000000000d1', extensions.digest('tn6', 'sha256'), now() + interval '1 day'),
  ('20000000-0000-0000-0000-0000000000d2', extensions.digest('tn4', 'sha256'), now() + interval '1 day'),
  ('20000000-0000-0000-0000-0000000000d2', extensions.digest('tn5', 'sha256'), now() + interval '1 day');

select is(
  private.get_contact_for_token('tn4') -> 'contact'
    -> 'first_name' || (private.get_contact_for_token('tn4') -> 'contact' -> 'kids'),
  '["Priya", {"first": "Asha"}]'::jsonb,
  'get_contact_for_token returns the structured names');

select ok(private.apply_token_reply('tn1',
  '{"first_name": "Jen", "last_name": "Holloway", "kids": [{"first": "  "}]}') is null,
  'invalid kids are refused');
select ok(private.apply_token_reply('tn1', '{"kids": "Zoe"}') is null,
  'non-array kids are refused');

select is(private.apply_token_reply('tn1',
  '{"first_name": " Jen ", "last_name": "Holloway",
    "partner_first_name": "Mark", "partner_last_name": "Holloway",
    "kids": [{"first": "Zoe", "last": "Holloway"}, {"first": "Max", "last": ""}],
    "hax": "pwn"}'), 'applied',
  'structured token update succeeds');
select results_eq(
  $$ select full_name, first_name, last_name, partner_name, partner_first_name,
            partner_last_name, kids_names, kids
     from public.contacts where id = '20000000-0000-0000-0000-0000000000d1' $$,
  $$ values ('Jen Holloway', 'Jen', 'Holloway', 'Mark Holloway', 'Mark', 'Holloway',
             'Zoe, Max', '[{"first": "Zoe", "last": "Holloway"}, {"first": "Max"}]'::jsonb) $$,
  'structured names are stored and display strings derived');
select is(
  (select array_agg(k order by k) from public.contact_events e,
     jsonb_object_keys(e.diff -> 'payload') k
   where e.contact_id = '20000000-0000-0000-0000-0000000000d1'),
  array['first_name', 'kids', 'last_name', 'partner_first_name', 'partner_last_name'],
  'audit keeps the structured keys and drops junk');

select is(private.apply_token_reply('tn2',
  '{"first_name": "Jen", "last_name": "Holloway",
    "partner_first_name": "", "partner_last_name": "", "kids": []}'), 'applied',
  'clearing token update succeeds');
select results_eq(
  $$ select partner_name, partner_first_name, partner_last_name, kids_names, kids
     from public.contacts where id = '20000000-0000-0000-0000-0000000000d1' $$,
  $$ values (null::text, null::text, null::text, null::text, null::jsonb) $$,
  'empty partner and kids clear the partner and kids');

select is(private.apply_token_reply('tn6',
  '{"first_name": "Jen", "last_name": "Holloway",
    "partner_first_name": "", "partner_last_name": "Okafor"}'), 'applied',
  'token update with only a partner last name succeeds');
select results_eq(
  $$ select partner_name, partner_first_name, partner_last_name
     from public.contacts where id = '20000000-0000-0000-0000-0000000000d1' $$,
  $$ values (null::text, null::text, null::text) $$,
  'a partner last name without a first name stores no partner');

select is(private.apply_token_reply('tn3', '{"partner_name": "Sam Lee", "full_name": "Jen H"}'), 'applied',
  'legacy token update succeeds');
select results_eq(
  $$ select full_name, first_name, partner_name
     from public.contacts where id = '20000000-0000-0000-0000-0000000000d1' $$,
  $$ values ('Jen H', null::text, 'Sam Lee') $$,
  'legacy keys write display strings and clear the stale structured name');

select is(private.apply_token_reply('tn4',
  '{"first_name": "Priya", "last_name": "Raman-Okafor",
    "partner_first_name": "", "kids": [{"first": "Nope"}]}'), 'applied',
  'token update on a book with partner and kids disabled succeeds');
select results_eq(
  $$ select full_name, last_name, partner_name, partner_first_name, kids_names, kids
     from public.contacts where id = '20000000-0000-0000-0000-0000000000d2' $$,
  $$ values ('Priya Raman-Okafor', 'Raman-Okafor', 'Daniel Okafor', 'Daniel', 'Asha',
             '[{"first": "Asha"}]'::jsonb) $$,
  'disabled partner and kids keys are ignored');

select is(private.apply_token_reply('tn5', '{"first_name": "P", "last_name": " "}'), 'applied',
  'token update with a half name succeeds');
select results_eq(
  $$ select full_name, first_name from public.contacts
     where id = '20000000-0000-0000-0000-0000000000d2' $$,
  $$ values ('Priya Raman-Okafor', 'Priya') $$,
  'a half name leaves the stored name alone');
select ok(private.apply_token_reply('tn5', '{"city": "Again"}') is null,
  'structured token updates are single-use too');
select is(
  (select count(*)::int from public.contact_events
   where contact_id = '20000000-0000-0000-0000-0000000000d2' and source = 'token'),
  2, 'each applied update writes one audit row');

select * from finish();
rollback;
