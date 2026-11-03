begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

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

select * from finish();
rollback;
