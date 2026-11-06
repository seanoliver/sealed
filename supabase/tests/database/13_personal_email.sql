begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000fe001', 'pe@test.dev');
insert into public.books (id, owner_id, slug, enabled_fields)
values ('10000000-0000-4000-8000-0000000fe001', '00000000-0000-4000-8000-0000000fe001', 'pe-book',
        '{"partner_name": true, "kids_names": true, "birthday": true}');
insert into public.contacts (id, book_id, full_name, first_name, last_name, email, partner_email, city) values
  ('20000000-0000-4000-8000-0000000fe001', '10000000-0000-4000-8000-0000000fe001',
   'Ana Reyes', 'Ana', 'Reyes', 'ana@acme.test', 'mark@globex.test', 'Oslo'),
  ('20000000-0000-4000-8000-0000000fe002', '10000000-0000-4000-8000-0000000fe001',
   'Cal Ortiz', 'Cal', 'Ortiz', 'cal@acme.test', null, 'Oslo');
insert into public.update_tokens (contact_id, token_hash, expires_at, recipient) values
  ('20000000-0000-4000-8000-0000000fe001', extensions.digest('pe-ana', 'sha256'), now() + interval '1 day', 'primary'),
  ('20000000-0000-4000-8000-0000000fe001', extensions.digest('pe-ana-2', 'sha256'), now() + interval '1 day', 'primary'),
  ('20000000-0000-4000-8000-0000000fe001', extensions.digest('pe-mark', 'sha256'), now() + interval '1 day', 'partner'),
  ('20000000-0000-4000-8000-0000000fe002', extensions.digest('pe-cal', 'sha256'), now() + interval '1 day', 'primary');

create function pg_temp.ana() returns public.contacts language sql as $$
  select * from public.contacts where id = '20000000-0000-4000-8000-0000000fe001'
$$;

-- First personal address: nothing is lost, so every link stays.
select is(private.apply_token_reply('pe-ana', '{"personal_email": "ana@home.test"}'), 'applied',
  'a recipient can add a personal email');
select is((pg_temp.ana()).personal_email::text, 'ana@home.test', 'it lands in personal_email');
select is((pg_temp.ana()).email::text, 'ana@acme.test', 'the work email is not overwritten');
select ok(private.get_contact_for_token('pe-ana') is not null, 'the link they used stays live');
select ok(private.get_contact_for_token('pe-ana-2') is not null, 'so does the other link for that person');
select ok(private.get_contact_for_token('pe-mark') is not null, 'and the partner link');

-- The other person's personal address never reaches this link.
select is(private.get_contact_for_token('pe-ana') #>> '{contact,personal_email}', 'ana@home.test',
  'a link shows its own person''s personal email');
select is(private.get_contact_for_token('pe-mark') #>> '{contact,personal_email}', null,
  'the partner''s link does not show the primary''s');

-- A partner's reply writes only their own column, whatever keys it carries.
select is(private.apply_token_reply('pe-mark',
  '{"personal_email": "mark@home.test", "partner_personal_email": "junk@evil.test"}'), 'applied',
  'a partner can add a personal email');
select is((pg_temp.ana()).partner_personal_email::text, 'mark@home.test',
  'a partner''s personal_email lands in partner_personal_email');
select is((pg_temp.ana()).personal_email::text, 'ana@home.test', 'the primary''s is untouched');
select is(private.apply_token_reply('pe-ana', '{"partner_personal_email": "junk@evil.test"}'), 'applied',
  'a primary reply with a smuggled partner key still applies');
select is((pg_temp.ana()).partner_personal_email::text, 'mark@home.test', 'the smuggled key is ignored');
select is((select count(*)::int from public.contact_events
           where contact_id = '20000000-0000-4000-8000-0000000fe001'
             and diff -> 'payload' ? 'partner_personal_email'), 0,
  'the smuggled key never reaches the audit trail');

-- An address that adds nothing is dropped, not saved.
select is(private.apply_token_reply('pe-ana', '{"personal_email": "ANA@acme.test"}'), 'applied',
  'typing the work address back still applies');
select is((pg_temp.ana()).personal_email::text, 'ana@home.test', 'the person''s own email is dropped');
select private.apply_token_reply('pe-ana', '{"personal_email": "mark@globex.test"}');
select is((pg_temp.ana()).personal_email::text, 'ana@home.test', 'the other person''s email is dropped');
select private.apply_token_reply('pe-ana', '{"personal_email": "mark@home.test"}');
select is((pg_temp.ana()).personal_email::text, 'ana@home.test',
  'the other person''s personal email is dropped');

-- Another contact's address: same outcome, nothing revealed, no index touched.
select is(private.apply_token_reply('pe-cal', '{"personal_email": "ana@acme.test"}'), 'applied',
  'an address that is another contact''s email replies like any other');
select is((select personal_email::text from public.contacts
           where id = '20000000-0000-4000-8000-0000000fe002'), 'ana@acme.test',
  'and is stored, leaving contacts_book_email_unique alone');

-- Changing a personal address retires the links that could have gone to it.
select set_config('sealed.reply_token_hash', '', true);
select is(private.apply_token_reply('pe-ana', '{"personal_email": "ana@new.test"}'), 'applied',
  'a recipient can change their personal email');
select ok(private.get_contact_for_token('pe-ana') is not null, 'the link they used stays live');
select ok(private.get_contact_for_token('pe-ana-2') is null, 'that person''s other links are revoked');
select ok(private.get_contact_for_token('pe-mark') is not null, 'the partner''s link is not');

select set_config('sealed.reply_token_hash', '', true);
update public.contacts set personal_email = null where id = '20000000-0000-4000-8000-0000000fe001';
select ok(private.get_contact_for_token('pe-ana') is null, 'an owner removing it revokes every link for that person');

-- An override describes one address.
update public.contacts set email_kind = 'personal', partner_email_kind = 'work'
where id = '20000000-0000-4000-8000-0000000fe001';
update public.contacts set partner_email = 'mark@initech.test'
where id = '20000000-0000-4000-8000-0000000fe001';
select is((pg_temp.ana()).partner_email_kind, null, 'a new address resets its kind');
select is((pg_temp.ana()).email_kind, 'personal', 'and leaves the other person''s alone');
update public.contacts set email = 'ana@initech.test', email_kind = 'work'
where id = '20000000-0000-4000-8000-0000000fe001';
select is((pg_temp.ana()).email_kind, 'work', 'a kind set with the new address sticks');

-- Conflict queue: the partner's reply waits under the partner's key.
insert into public.contacts (id, book_id, full_name, first_name, last_name, email, partner_email, city) values
  ('20000000-0000-4000-8000-0000000fe003', '10000000-0000-4000-8000-0000000fe001',
   'Dee Park', 'Dee', 'Park', 'dee@acme.test', 'eli@acme.test', 'Oslo');
insert into public.update_tokens (contact_id, token_hash, expires_at, recipient) values
  ('20000000-0000-4000-8000-0000000fe003', extensions.digest('pe-dee', 'sha256'), now() + interval '1 day', 'primary'),
  ('20000000-0000-4000-8000-0000000fe003', extensions.digest('pe-eli', 'sha256'), now() + interval '1 day', 'partner');
select private.apply_token_reply('pe-dee', '{"city": "Rome"}', now() - interval '1 minute');
select is(private.apply_token_reply('pe-eli', '{"personal_email": "eli@home.test"}', now() - interval '1 minute'),
  'queued', 'a personal email that crosses the other person''s change is queued');
select is((select payload ->> 'partner_personal_email' from public.submissions
           where matched_contact_id = '20000000-0000-4000-8000-0000000fe003'), 'eli@home.test',
  'under partner_personal_email');

-- A self-add from a personal address matches the contact that holds it.
update public.contacts set personal_email = 'dee@home.test', partner_personal_email = 'eli@home.test'
where id = '20000000-0000-4000-8000-0000000fe003';
select private.submit_to_book('pe-book', '{"email": "DEE@home.test", "probe": "a"}');
select private.submit_to_book('pe-book', '{"email": "eli@home.test", "probe": "b"}');
select is((select matched_contact_id::text from public.submissions where payload ->> 'probe' = 'a'),
  '20000000-0000-4000-8000-0000000fe003', 'submit_to_book matches personal_email');
select is((select matched_contact_id::text from public.submissions where payload ->> 'probe' = 'b'),
  '20000000-0000-4000-8000-0000000fe003', 'submit_to_book matches partner_personal_email');

select * from finish();
rollback;
