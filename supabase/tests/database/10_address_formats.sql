begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000099001', 'af@test.dev');
insert into public.books (id, owner_id, slug)
values ('10000000-0000-4000-8000-000000099001', '00000000-0000-4000-8000-000000099001', 'af-test-book');

select is((select sender_country from public.books where id = '10000000-0000-4000-8000-000000099001'), 'US',
  'a book mails from the US until its owner says otherwise');
select throws_ok($$
  update public.books set sender_country = 'usa' where id = '10000000-0000-4000-8000-000000099001'
$$, '23514', null, 'the sender country is a two-letter code');

select results_eq(
  $$ select private.country_code_for(t) from unnest(array[
       'United States', 'USA', 'usa', 'US', 'u.s.a.', 'CHINA', 'PRC', '中国', 'Netherlands',
       'the netherlands', 'Holland', 'United Kingdom', 'UK', 'Great Britain', 'England',
       'Singapore', 'Greece', 'Spain', 'España', 'South Africa', 'Germany', ' germany ']) t $$,
  $$ values ('US'), ('US'), ('US'), ('US'), ('US'), ('CN'), ('CN'), ('CN'), ('NL'), ('NL'), ('NL'),
            ('GB'), ('GB'), ('GB'), ('GB'), ('SG'), ('GR'), ('ES'), ('ES'), ('ZA'), ('DE'), ('DE') $$,
  'country names, aliases and codes map to codes, ignoring case, dots and accents');
select is(private.country_code_for('Atlantis'), null, 'unknown text maps to nothing');
select is(private.country_code_for(''), null, 'blank text maps to nothing');
select is(private.country_code_for(null), null, 'no text maps to nothing');

select throws_ok($$
  insert into public.contacts (book_id, full_name, country_code)
  values ('10000000-0000-4000-8000-000000099001', 'Bad Code', 'usa')
$$, '23514', null, 'a country code is two capital letters');
select throws_ok($$
  insert into public.contacts (book_id, full_name, district)
  values ('10000000-0000-4000-8000-000000099001', 'Long District', repeat('d', 121))
$$, '23514', null, 'a district has the same cap as a city');

insert into public.contacts (id, book_id, full_name, email, country) values
  ('20000000-0000-4000-8000-000000099001', '10000000-0000-4000-8000-000000099001', 'Ana', 'ana@af.test', 'United Kingdom'),
  ('20000000-0000-4000-8000-000000099002', '10000000-0000-4000-8000-000000099001', 'Ben', 'ben@af.test', 'Atlantis'),
  ('20000000-0000-4000-8000-000000099003', '10000000-0000-4000-8000-000000099001', 'Cai', 'cai@af.test', null);
select results_eq(
  $$ select country, country_code from public.contacts
     where id in ('20000000-0000-4000-8000-000000099001', '20000000-0000-4000-8000-000000099002',
                  '20000000-0000-4000-8000-000000099003') order by id $$,
  $$ values ('United Kingdom', 'GB'), ('Atlantis', null), (null::text, null::text) $$,
  'an old-style insert gets its code; unknown text stays visible with no code');

update public.contacts set country = 'holland' where id = '20000000-0000-4000-8000-000000099001';
select is((select country_code from public.contacts where id = '20000000-0000-4000-8000-000000099001'), 'NL',
  'an old-style country edit moves the code');

update public.contacts set country = 'Atlantis' where id = '20000000-0000-4000-8000-000000099001';
select is((select country_code from public.contacts where id = '20000000-0000-4000-8000-000000099001'), null,
  'an old-style edit to unknown text clears the code');

update public.contacts set country_code = 'GR', country = null where id = '20000000-0000-4000-8000-000000099002';
select results_eq(
  $$ select country, country_code from public.contacts where id = '20000000-0000-4000-8000-000000099002' $$,
  $$ values (null::text, 'GR') $$,
  'a new-style write of a code and cleared text keeps the code');

update public.contacts set country = null where id = '20000000-0000-4000-8000-000000099002';
select is((select country_code from public.contacts where id = '20000000-0000-4000-8000-000000099002'), 'GR',
  'clearing leftover text keeps the code');

insert into public.contacts (id, book_id, full_name, country, country_code) values
  ('20000000-0000-4000-8000-000000099004', '10000000-0000-4000-8000-000000099001', 'Dee', 'United States', 'CA');
select is((select country_code from public.contacts where id = '20000000-0000-4000-8000-000000099004'), 'CA',
  'an insert that names its code keeps it');

update public.contacts set country_code = 'US', country = 'United States', city = 'Portland',
  district = null where id = '20000000-0000-4000-8000-000000099003';
insert into public.update_tokens (contact_id, token_hash, expires_at) values
  ('20000000-0000-4000-8000-000000099003', extensions.digest('af1', 'sha256'), now() + interval '1 day'),
  ('20000000-0000-4000-8000-000000099003', extensions.digest('af2', 'sha256'), now() + interval '1 day'),
  ('20000000-0000-4000-8000-000000099003', extensions.digest('af3', 'sha256'), now() + interval '1 day'),
  ('20000000-0000-4000-8000-000000099003', extensions.digest('af4', 'sha256'), now() + interval '1 day');

select is(private.get_contact_for_token('af1') -> 'contact' ->> 'country_code', 'US',
  'the recipient page gets the country code');
select ok(private.get_contact_for_token('af1') -> 'contact' ? 'district',
  'the recipient page gets the district');
select is(private.get_contact_for_token('af1') ->> 'sender_country', 'US',
  'the recipient page gets the sender country for the envelope preview');
select is(private.get_contact_for_token('af1') -> 'contact' ->> 'country', 'United States',
  'the recipient page still gets the old country text');

select is(private.apply_token_reply('af1',
  '{"country_code": "CN", "district": "浦东新区", "city": "上海市", "state_region": "上海市", "postal_code": "201203", "hax": 1}'),
  'applied', 'a reply with a code and district applies');
select results_eq(
  $$ select country_code, country, district, city, postal_code from public.contacts
     where id = '20000000-0000-4000-8000-000000099003' $$,
  $$ values ('CN', null::text, '浦东新区', '上海市', '201203') $$,
  'the reply sets the code and district and settles the old text');
select is((select diff -> 'payload' from public.contact_events
           where contact_id = '20000000-0000-4000-8000-000000099003' and source = 'token'),
  '{"country_code": "CN", "district": "浦东新区", "city": "上海市", "state_region": "上海市", "postal_code": "201203"}'::jsonb,
  'the audit keeps the code and district and drops unknown keys');

select is(private.apply_token_reply('af2', '{"country": "Germany"}'), 'applied',
  'a reply from the old form, with country text, applies');
select results_eq(
  $$ select country_code, country from public.contacts where id = '20000000-0000-4000-8000-000000099003' $$,
  $$ values ('DE', 'Germany') $$,
  'the old form''s country text sets the code');

select is(private.apply_token_reply('af3', '{"country_code": "usa"}'), null,
  'a malformed code is a bad payload');
select is((select used_at from public.update_tokens where token_hash = extensions.digest('af3', 'sha256')), null,
  'a bad payload leaves the link usable');
select is(private.apply_token_reply('af3', '{"country_code": "", "district": ""}'), 'applied',
  'an empty code clears it');
select results_eq(
  $$ select country_code, country, district from public.contacts where id = '20000000-0000-4000-8000-000000099003' $$,
  $$ values (null::text, 'Germany', null::text) $$,
  'an empty code clears the code and district but keeps old text for the owner');

update public.contacts set partner_email = 'eve@af.test', country_code = 'US'
where id = '20000000-0000-4000-8000-000000099001';
insert into public.contact_events (contact_id, source, recipient, diff, created_at) values
  ('20000000-0000-4000-8000-000000099001', 'token', 'primary',
   '{"before": {"city": "Rome"}, "after": {"city": "Oslo"}}', now() - interval '30 min');
insert into public.update_tokens (contact_id, token_hash, expires_at, recipient) values
  ('20000000-0000-4000-8000-000000099001', extensions.digest('afq', 'sha256'), now() + interval '1 day', 'partner');
select is(private.apply_token_reply('afq', '{"country_code": "GB", "district": "", "city": "Bristol"}',
  now() - interval '1 hour'), 'queued', 'a colliding reply is queued');
select is((select payload from public.submissions
           where matched_contact_id = '20000000-0000-4000-8000-000000099001'),
  '{"country_code": "GB", "district": "", "city": "Bristol"}'::jsonb,
  'the queued reply keeps the code and district');
select is((select country_code from public.contacts where id = '20000000-0000-4000-8000-000000099001'), 'US',
  'the queued reply changes nothing yet');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000099001", "role": "authenticated"}';
update public.contacts set country_code = 'SG', district = 'Tanjong Pagar'
where id = '20000000-0000-4000-8000-000000099004';
update public.books set sender_country = 'GB' where id = '10000000-0000-4000-8000-000000099001';
reset role;
select results_eq(
  $$ select country_code, district from public.contacts where id = '20000000-0000-4000-8000-000000099004' $$,
  $$ values ('SG', 'Tanjong Pagar') $$,
  'the owner can set a code and district');
select is((select sender_country from public.books where id = '10000000-0000-4000-8000-000000099001'), 'GB',
  'the owner can change the sender country');

select has_column('public', 'contacts', 'country_code', 'contacts have a country code');
select has_column('public', 'contacts', 'district', 'contacts have a district');
select has_column('public', 'contacts', 'country', 'contacts keep the old country text');
select function_privs_are('private', 'country_code_for', array['text'], 'authenticated', array[]::text[],
  'client roles cannot call the country lookup');
select function_privs_are('private', 'sync_country_code', array[]::text[], 'authenticated', array[]::text[],
  'client roles cannot call the trigger function');
select trigger_is('public', 'contacts', 'contacts_sync_country_code', 'private', 'sync_country_code',
  'old-style country writes keep the code in step');

select * from finish();
rollback;
