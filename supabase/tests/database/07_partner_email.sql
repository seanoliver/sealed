begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000095001', 'pe@test.dev');
insert into public.books (id, owner_id, slug, enabled_fields)
values ('10000000-0000-4000-8000-000000095001', '00000000-0000-4000-8000-000000095001', 'pe-test-book',
        '{"partner_name": true, "kids_names": true, "birthday": true}');
insert into public.contacts (id, book_id, full_name, email, partner_email, city) values
  ('20000000-0000-4000-8000-000000095001', '10000000-0000-4000-8000-000000095001', 'Ana Reyes', 'ana@pe.test', 'ben@pe.test', 'Oslo'),
  ('20000000-0000-4000-8000-000000095002', '10000000-0000-4000-8000-000000095001', 'Cal Ortiz', 'cal@pe.test', 'dee@pe.test', 'Oslo'),
  ('20000000-0000-4000-8000-000000095003', '10000000-0000-4000-8000-000000095001', 'Eva Lund', 'eva@pe.test', 'fin@pe.test', 'Oslo'),
  ('20000000-0000-4000-8000-000000095004', '10000000-0000-4000-8000-000000095001', 'Gus Hale', 'gus@pe.test', 'hal@pe.test', 'Oslo'),
  ('20000000-0000-4000-8000-000000095005', '10000000-0000-4000-8000-000000095001', 'Ida Moss', 'ida@pe.test', 'jo@pe.test', 'Oslo'),
  ('20000000-0000-4000-8000-000000095006', '10000000-0000-4000-8000-000000095001', 'Kai Ruiz', 'kai@pe.test', 'lu@pe.test', 'Oslo'),
  ('20000000-0000-4000-8000-000000095007', '10000000-0000-4000-8000-000000095001', 'Mo Park', 'mo@pe.test', 'ned@pe.test', 'Oslo'),
  ('20000000-0000-4000-8000-000000095008', '10000000-0000-4000-8000-000000095001', 'Pat Vu', 'pat@pe.test', 'quy@pe.test', 'Oslo'),
  ('20000000-0000-4000-8000-000000095009', '10000000-0000-4000-8000-000000095001', 'Rae Kim', 'rae@pe.test', 'sol@pe.test', 'Oslo');

select throws_ok($$
  update public.contacts set partner_email = 'ANA@pe.test'
  where id = '20000000-0000-4000-8000-000000095001'
$$, '23514', null, 'the partner email must differ from the email, ignoring case');

select throws_ok($$
  update public.contacts set partner_email = repeat('a', 313) || '@pe.test'
  where id = '20000000-0000-4000-8000-000000095001'
$$, '23514', null, 'the partner email has the same length cap as the email');

select throws_ok($$
  insert into public.update_tokens (contact_id, token_hash, expires_at, recipient)
  values ('20000000-0000-4000-8000-000000095001', 'x', now() + interval '1 day', 'spouse')
$$, '23514', null, 'a token belongs to the primary or the partner');

select throws_ok($$
  insert into public.email_sends (contact_id, book_id, recipient)
  values ('20000000-0000-4000-8000-000000095001', '10000000-0000-4000-8000-000000095001', 'spouse')
$$, '23514', null, 'a send belongs to the primary or the partner');

insert into public.email_sends (contact_id, book_id)
values ('20000000-0000-4000-8000-000000095001', '10000000-0000-4000-8000-000000095001');
select is((select recipient from public.email_sends
           where contact_id = '20000000-0000-4000-8000-000000095001'), 'primary',
  'existing send paths default to the primary');

insert into public.update_tokens (contact_id, token_hash, expires_at, recipient) values
  ('20000000-0000-4000-8000-000000095001', 'rp', now() + interval '1 day', 'primary'),
  ('20000000-0000-4000-8000-000000095001', 'rq', now() + interval '1 day', 'partner');

update public.contacts set partner_email = 'BEN@pe.test'
where id = '20000000-0000-4000-8000-000000095001';
select is((select count(*)::int from public.update_tokens where token_hash in ('rp', 'rq')), 2,
  'a partner email change only in letter case keeps both links');

update public.contacts set partner_email = 'ben@new.test'
where id = '20000000-0000-4000-8000-000000095001';
select is((select array_agg(convert_from(token_hash, 'utf8')) from public.update_tokens
           where token_hash in ('rp', 'rq')), array['rp'],
  'a new partner email revokes only the partner link');

insert into public.update_tokens (contact_id, token_hash, expires_at, recipient)
values ('20000000-0000-4000-8000-000000095001', 'rq', now() + interval '1 day', 'partner');
update public.contacts set email = 'ana@new.test'
where id = '20000000-0000-4000-8000-000000095001';
select is((select array_agg(convert_from(token_hash, 'utf8')) from public.update_tokens
           where token_hash in ('rp', 'rq')), array['rq'],
  'a new email revokes only the primary link');

insert into public.update_tokens (contact_id, token_hash, expires_at, recipient) values
  ('20000000-0000-4000-8000-000000095001', extensions.digest('wq1', 'sha256'), now() + interval '1 day', 'partner');

select is(private.get_contact_for_token('wq1') -> 'contact' ->> 'email', 'ben@new.test',
  'the partner sees their own email');
select is(private.get_contact_for_token('wq1') ->> 'recipient', 'partner',
  'the token data names the recipient');
select ok((private.get_contact_for_token('wq1') ->> 'updated_at')::timestamptz
          = (select updated_at from public.contacts where id = '20000000-0000-4000-8000-000000095001'),
  'updated_at round-trips exactly');

select is(private.apply_token_reply('wq1', '{"email": "ben@other.test"}'), 'applied',
  'a partner update applies');
select results_eq(
  $$ select email::text, partner_email::text from public.contacts
     where id = '20000000-0000-4000-8000-000000095001' $$,
  $$ values ('ana@new.test', 'ben@other.test') $$,
  'the partner''s email field writes partner_email');
select is((select recipient from public.contact_events
           where contact_id = '20000000-0000-4000-8000-000000095001' and source = 'token'),
  'partner', 'the change records which person made it');

insert into public.update_tokens (contact_id, token_hash, expires_at, recipient)
values ('20000000-0000-4000-8000-000000095001', extensions.digest('wq2', 'sha256'), now() + interval '1 day', 'partner');
select is(private.apply_token_reply('wq2', '{"email": "ANA@new.test", "city": "Bergen"}'), 'applied',
  'a partner email that matches the primary email does not fail the save');
select results_eq(
  $$ select partner_email::text, city from public.contacts
     where id = '20000000-0000-4000-8000-000000095001' $$,
  $$ values ('ben@other.test', 'Bergen') $$,
  'that email is ignored and the rest applies');

insert into public.contact_events (contact_id, source, recipient, diff, created_at) values
  ('20000000-0000-4000-8000-000000095002', 'token', 'primary', '{"before": {"city": "Rome"}, "after": {"city": "Oslo"}}', now() - interval '30 min'),
  ('20000000-0000-4000-8000-000000095003', 'token', 'primary', '{"before": {"city": "Rome"}, "after": {"city": "Oslo"}}', now() - interval '30 min'),
  ('20000000-0000-4000-8000-000000095004', 'token', 'partner', '{"before": {"city": "Rome"}, "after": {"city": "Oslo"}}', now() - interval '30 min'),
  ('20000000-0000-4000-8000-000000095005', 'token', 'primary', '{"before": {"city": "Rome"}, "after": {"city": "Oslo"}}', now() - interval '30 min'),
  ('20000000-0000-4000-8000-000000095005', 'owner', null, '{}', now() - interval '10 min'),
  ('20000000-0000-4000-8000-000000095006', 'token', 'primary', '{"before": {"city": "Rome"}, "after": {"city": "Oslo"}}', now() - interval '30 min'),
  ('20000000-0000-4000-8000-000000095007', 'token', 'primary', '{"before": {"city": "Rome"}, "after": {"city": "Oslo"}}', now() - interval '30 min');
insert into public.update_tokens (contact_id, token_hash, expires_at, recipient) values
  ('20000000-0000-4000-8000-000000095002', extensions.digest('c2', 'sha256'), now() + interval '1 day', 'partner'),
  ('20000000-0000-4000-8000-000000095003', extensions.digest('c3', 'sha256'), now() + interval '1 day', 'partner'),
  ('20000000-0000-4000-8000-000000095004', extensions.digest('c4', 'sha256'), now() + interval '1 day', 'partner'),
  ('20000000-0000-4000-8000-000000095005', extensions.digest('c5', 'sha256'), now() + interval '1 day', 'partner'),
  ('20000000-0000-4000-8000-000000095006', extensions.digest('c6', 'sha256'), now() + interval '1 day', 'partner'),
  ('20000000-0000-4000-8000-000000095007', extensions.digest('c7', 'sha256'), now() + interval '1 day', 'partner');

select is(private.apply_token_reply('c2',
  '{"city": "Paris", "email": "dee@new.test", "address_line2": "", "hax": 1}', now() - interval '1 hour'),
  'queued', 'a differing answer after the other person''s change is queued');
select results_eq(
  $$ select city, partner_email::text from public.contacts
     where id = '20000000-0000-4000-8000-000000095002' $$,
  $$ values ('Oslo', 'dee@pe.test') $$,
  'a queued answer leaves the contact alone');
select results_eq(
  $$ select status, payload from public.submissions
     where matched_contact_id = '20000000-0000-4000-8000-000000095002' $$,
  $$ values ('pending', '{"city": "Paris", "partner_email": "dee@new.test", "address_line2": ""}'::jsonb) $$,
  'the review queue gets the answer, empty values kept, unknown keys dropped, the partner email under its own key');
select results_eq(
  $$ select source, recipient, saved_by from public.submissions
     where matched_contact_id = '20000000-0000-4000-8000-000000095002' $$,
  $$ values ('token', 'partner', 'primary') $$,
  'the queued answer records who sent it and whose change it would replace');
select isnt((select used_at from public.update_tokens
             where token_hash = extensions.digest('c2', 'sha256')), null,
  'a queued answer spends the token');
select is((select count(*)::int from public.contact_events
           where contact_id = '20000000-0000-4000-8000-000000095002' and recipient = 'partner'), 0,
  'a queued answer records no change');

select is(private.apply_token_reply('c3', '{}', now() - interval '1 hour'), 'applied',
  'a confirm after the other person''s change applies');
select is(private.apply_token_reply('c7', '{"city": "Oslo", "email": "ned@pe.test"}', now() - interval '1 hour'),
  'applied', 'an answer that matches the current values counts as a confirm');
select is((select count(*)::int from public.submissions
           where matched_contact_id in ('20000000-0000-4000-8000-000000095003',
                                        '20000000-0000-4000-8000-000000095007')), 0,
  'a matching answer queues nothing');
select is((select count(*)::int from public.contact_events
           where contact_id in ('20000000-0000-4000-8000-000000095003',
                                '20000000-0000-4000-8000-000000095007') and recipient = 'partner'), 2,
  'a matching answer is still recorded as a reply');
select isnt((select used_at from public.update_tokens
             where token_hash = extensions.digest('c7', 'sha256')), null,
  'a matching answer spends the token');

select is(private.apply_token_reply('c4', '{"city": "Paris"}', now() - interval '1 hour'), 'applied',
  'a second answer from the same person applies');
select is((select city from public.contacts where id = '20000000-0000-4000-8000-000000095004'), 'Paris',
  'the same person''s answer overwrites');

select is(private.apply_token_reply('c5', '{"city": "Paris"}', now() - interval '1 hour'), 'queued',
  'an owner edit after the other person''s change does not hide the collision');

select is(private.apply_token_reply('c6', '{"city": "Paris"}', now()), 'applied',
  'an answer from a page loaded after the change applies');
select is((select city from public.contacts where id = '20000000-0000-4000-8000-000000095006'), 'Paris',
  'that answer overwrites');

insert into public.update_tokens (contact_id, token_hash, expires_at, recipient) values
  ('20000000-0000-4000-8000-000000095008', extensions.digest('p8', 'sha256'), now() + interval '1 day', 'primary'),
  ('20000000-0000-4000-8000-000000095008', extensions.digest('q8', 'sha256'), now() + interval '1 day', 'partner'),
  ('20000000-0000-4000-8000-000000095009', extensions.digest('p9', 'sha256'), now() + interval '1 day', 'primary'),
  ('20000000-0000-4000-8000-000000095009', extensions.digest('q9', 'sha256'), now() + interval '1 day', 'partner');

select is(private.apply_token_reply('q8', '{"city": "Rome"}'), 'applied', 'the partner answers first');
update public.contacts set city = 'Lima' where id = '20000000-0000-4000-8000-000000095008';
select is(private.apply_token_reply('p8', '{"city": "Paris"}', now() - interval '1 hour'), 'queued',
  'a stale answer after the partner''s change and an owner edit is queued');
select is((select city from public.contacts where id = '20000000-0000-4000-8000-000000095008'), 'Lima',
  'the stale answer overwrites nothing');

select is(private.apply_token_reply('p9', '{}'), 'applied', 'the primary confirms without changes');
select is(private.apply_token_reply('q9', '{"city": "Paris"}', now() - interval '1 hour'), 'applied',
  'a real change after the other person''s no-op confirm applies');
select is((select city from public.contacts where id = '20000000-0000-4000-8000-000000095009'), 'Paris',
  'that change is saved');

select is((select count(*)::int from public.submissions
           where book_id = '10000000-0000-4000-8000-000000095001'), 3,
  'only the differing collisions reached review');

insert into public.update_tokens (contact_id, token_hash, expires_at, recipient) values
  ('20000000-0000-4000-8000-000000095009', extensions.digest('old2', 'sha256'), now() + interval '1 day', 'primary');
select is(private.apply_token_update('old2', '{"city": "Bergen"}'), true,
  'the old two-argument call still applies and returns true for an app deployed before this');

select ok(private.submit_to_book('pe-test-book', '{"full_name": "Ana Reyes", "email": "ana@new.test"}'),
  'a permalink submission is accepted');
select results_eq(
  $$ select source, recipient, saved_by from public.submissions
     where matched_contact_id = '20000000-0000-4000-8000-000000095001' $$,
  $$ values ('permalink', null::text, null::text) $$,
  'a permalink submission matched by email is not marked as a reply');

select * from finish();
rollback;
