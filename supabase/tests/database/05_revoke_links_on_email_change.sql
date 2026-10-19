begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000ce001', 'rl@test.dev');
insert into public.books (id, owner_id, slug)
values ('10000000-0000-4000-8000-0000000ce001', '00000000-0000-4000-8000-0000000ce001', 'rl-test-book');
insert into public.contacts (id, book_id, full_name, email) values
  ('20000000-0000-4000-8000-0000000ce001', '10000000-0000-4000-8000-0000000ce001', 'Ana Reyes', 'ana@rl.test'),
  ('20000000-0000-4000-8000-0000000ce002', '10000000-0000-4000-8000-0000000ce001', 'Cal Ortiz', 'cal@rl.test');
insert into public.update_tokens (contact_id, token_hash, expires_at, used_at) values
  ('20000000-0000-4000-8000-0000000ce001', 'a1', now() + interval '1 day', null),
  ('20000000-0000-4000-8000-0000000ce001', 'a2', now() + interval '1 day', now()),
  ('20000000-0000-4000-8000-0000000ce002', 'c1', now() + interval '1 day', null);

update public.contacts set city = 'Oslo', email = 'ANA@rl.test'
where id = '20000000-0000-4000-8000-0000000ce001';
select is((select count(*)::int from public.update_tokens where token_hash = 'a1'), 1,
  'a change only in letter case keeps the link');

update public.contacts set email = 'ana@new.test'
where id = '20000000-0000-4000-8000-0000000ce001';
select is((select count(*)::int from public.update_tokens where token_hash = 'a1'), 0,
  'a new email revokes the unused link');
select is((select count(*)::int from public.update_tokens where token_hash = 'a2'), 1,
  'a used link stays as history');
select is((select count(*)::int from public.update_tokens where token_hash = 'c1'), 1,
  'other contacts keep their links');

select * from finish();
rollback;
