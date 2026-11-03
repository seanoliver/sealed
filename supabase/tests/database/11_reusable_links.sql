begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000eb001', 'rlk@test.dev');
insert into public.books (id, owner_id, slug, enabled_fields)
values ('10000000-0000-4000-8000-0000000eb001', '00000000-0000-4000-8000-0000000eb001', 'rlk-book',
        '{"partner_name": true, "kids_names": true, "birthday": true}');
insert into public.contacts (id, book_id, full_name, first_name, last_name, email, city) values
  ('20000000-0000-4000-8000-0000000eb001', '10000000-0000-4000-8000-0000000eb001',
   'Ana Reyes', 'Ana', 'Reyes', 'ana@rlk.test', 'Oslo');
insert into public.update_tokens (contact_id, token_hash, expires_at) values
  ('20000000-0000-4000-8000-0000000eb001', extensions.digest('rlk-own', 'sha256'), now() + interval '1 day'),
  ('20000000-0000-4000-8000-0000000eb001', extensions.digest('rlk-old', 'sha256'), now() + interval '1 day');

-- A recipient fixing their own email keeps the link they used; other links die.
select is(private.apply_token_reply('rlk-own', '{"email": "ana.new@rlk.test"}'), 'applied',
  'a recipient can change their own email');
select ok(private.get_contact_for_token('rlk-own') is not null,
  'the link that changed the email keeps working');
select ok(private.get_contact_for_token('rlk-old') is null,
  'other links for that person are revoked');

-- An owner changing the email still revokes every link, the used one included.
-- (Each app request is its own transaction; reset the reply marker here.)
select set_config('sealed.reply_token_hash', '', true);
update public.contacts set email = 'ana.owner@rlk.test'
where id = '20000000-0000-4000-8000-0000000eb001';
select ok(private.get_contact_for_token('rlk-own') is null,
  'an owner email change revokes the used link');

-- A page opened before the same recipient's later save gets 'stale', not an overwrite.
insert into public.contacts (id, book_id, full_name, first_name, last_name, email, city) values
  ('20000000-0000-4000-8000-0000000eb002', '10000000-0000-4000-8000-0000000eb001',
   'Cal Ortiz', 'Cal', 'Ortiz', 'cal@rlk.test', 'Oslo');
insert into public.update_tokens (contact_id, token_hash, expires_at) values
  ('20000000-0000-4000-8000-0000000eb002', extensions.digest('rlk-tabs', 'sha256'), now() + interval '1 day');
select is(private.apply_token_reply('rlk-tabs', '{"city": "Bergen"}', now() - interval '1 minute'),
  'applied', 'the first tab saves');
select is(private.apply_token_reply('rlk-tabs', '{"city": "Oslo"}', now() - interval '1 minute'),
  'stale', 'a tab opened before that save is told to reload');
select is(private.apply_token_reply('rlk-tabs', '{"city": "Bergen"}', now() - interval '1 minute'),
  'applied', 'a retry of the saved answer after a lost response still applies');

-- A retry of a reply queued for review (it crossed the partner's change) queues once.
insert into public.contacts (id, book_id, full_name, first_name, last_name, email, partner_email, city) values
  ('20000000-0000-4000-8000-0000000eb003', '10000000-0000-4000-8000-0000000eb001',
   'Dee Park', 'Dee', 'Park', 'dee@rlk.test', 'eli@rlk.test', 'Oslo');
insert into public.update_tokens (contact_id, token_hash, expires_at, recipient) values
  ('20000000-0000-4000-8000-0000000eb003', extensions.digest('rlk-dee', 'sha256'), now() + interval '1 day', 'primary'),
  ('20000000-0000-4000-8000-0000000eb003', extensions.digest('rlk-eli', 'sha256'), now() + interval '1 day', 'partner');
select is(private.apply_token_reply('rlk-eli', '{"city": "Rome"}', now() - interval '1 minute'), 'applied',
  'the partner saves first');
select private.apply_token_reply('rlk-dee', '{"city": "Paris"}', now() - interval '1 minute');
select is(private.apply_token_reply('rlk-dee', '{"city": "Paris"}', now() - interval '1 minute'), 'queued_again',
  'a retry of a queued reply is not queued twice');
select is(private.apply_token_reply('rlk-dee', '{"city": "Madrid"}', now() - interval '1 minute'), 'queued',
  'a different reply while one is pending is queued too');
select is((select count(*)::int from public.submissions
           where matched_contact_id = '20000000-0000-4000-8000-0000000eb003' and status = 'pending'), 1,
  'the newer reply replaces the older one in review');
select ok((select payload ->> 'city' = 'Madrid' from public.submissions
           where matched_contact_id = '20000000-0000-4000-8000-0000000eb003' and status = 'pending'),
  'the reply left in review is the newer one');
select is(private.apply_token_reply('rlk-dee', '{"city": "Lima"}'), 'applied',
  'a reload and save applies directly');
select is((select count(*)::int from public.submissions
           where matched_contact_id = '20000000-0000-4000-8000-0000000eb003' and status = 'pending'), 0,
  'an applied reply closes the same person''s reply still in review');

-- A no-change reply from this person never makes an older page stale.
insert into public.contacts (id, book_id, full_name, first_name, last_name, email, city) values
  ('20000000-0000-4000-8000-0000000eb004', '10000000-0000-4000-8000-0000000eb001',
   'Fay Lin', 'Fay', 'Lin', 'fay@rlk.test', 'Oslo');
insert into public.update_tokens (contact_id, token_hash, expires_at) values
  ('20000000-0000-4000-8000-0000000eb004', extensions.digest('rlk-fay', 'sha256'), now() + interval '1 day');
select private.apply_token_reply('rlk-fay', '{}', now() - interval '1 minute');
select is(private.apply_token_reply('rlk-fay', '{"city": "Lima"}', now() - interval '1 minute'), 'applied',
  'a page older than a no-change confirm still saves');

-- Expiry is the only thing that retires an unrevoked link now, used or not.
insert into public.update_tokens (contact_id, token_hash, expires_at, used_at) values
  ('20000000-0000-4000-8000-0000000eb004', extensions.digest('rlk-expired', 'sha256'),
   now() - interval '1 minute', now() - interval '1 day');
select ok(private.get_contact_for_token('rlk-expired') is null, 'an expired used link reads nothing');
select ok(private.apply_token_reply('rlk-expired', '{"city": "Quito"}') is null, 'an expired used link applies nothing');

select * from finish();
rollback;
