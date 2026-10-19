begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000096001', 'nr@test.dev');
insert into public.books (id, owner_id, slug, enabled_fields)
values ('10000000-0000-4000-8000-000000096001', '00000000-0000-4000-8000-000000096001', 'nr-test-book',
        '{"partner_name": true, "kids_names": true, "birthday": true}');
insert into public.contacts (id, book_id, full_name, partner_name, email, partner_email,
                             name_reading, partner_name_reading)
values ('20000000-0000-4000-8000-000000096001', '10000000-0000-4000-8000-000000096001',
        '曾雨桐', '张伟', 'yt@nr.test', 'wei@nr.test', 'Céng Yǔtóng', 'Zhāng Wěi');

select throws_ok($$
  update public.contacts set name_reading = ''
  where id = '20000000-0000-4000-8000-000000096001'
$$, '23514', null, 'an empty reading is stored as null, never as an empty string');

select throws_ok($$
  update public.contacts set name_reading = repeat('a', 201)
  where id = '20000000-0000-4000-8000-000000096001'
$$, '23514', null, 'a reading has the same length cap as a full name');

select throws_ok($$
  update public.contacts set partner_name_reading = repeat('a', 201)
  where id = '20000000-0000-4000-8000-000000096001'
$$, '23514', null, 'a partner reading has the same length cap');

select lives_ok($$
  update public.contacts set partner_name_reading = repeat('a', 200)
  where id = '20000000-0000-4000-8000-000000096001'
$$, 'a reading of 200 characters fits');

insert into public.update_tokens (contact_id, token_hash, expires_at, recipient) values
  ('20000000-0000-4000-8000-000000096001', extensions.digest('nr-p', 'sha256'), now() + interval '1 day', 'primary'),
  ('20000000-0000-4000-8000-000000096001', extensions.digest('nr-q', 'sha256'), now() + interval '1 day', 'partner');

select ok(private.get_contact_for_token('nr-p')::text not like '%reading%'
          and private.get_contact_for_token('nr-p')::text not like '%Céng%',
  'the primary''s token data never includes a reading');
select ok(private.get_contact_for_token('nr-q')::text not like '%reading%',
  'the partner''s token data never includes a reading');

select is(private.apply_token_reply('nr-p',
  '{"full_name": "曾雨桐", "name_reading": "Hacked", "partner_name_reading": "Hacked"}'), 'applied',
  'a reply that smuggles readings still applies');
select is((select name_reading from public.contacts
           where id = '20000000-0000-4000-8000-000000096001'), 'Céng Yǔtóng',
  'a recipient reply never writes the reading');

set local role anon;
select throws_ok($$ select name_reading from public.contacts $$, '42501', null,
  'anonymous visitors cannot read contacts at all');
reset role;

select * from finish();
rollback;
