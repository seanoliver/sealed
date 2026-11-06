begin;
create schema if not exists tests;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000dd01', 'dd-owner@test.dev'),
  ('00000000-0000-0000-0000-00000000dd02', 'dd-other@test.dev'),
  ('00000000-0000-0000-0000-00000000dd03', 'dd-member@test.dev');

insert into public.books (id, owner_id, slug) values
  ('10000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-00000000dd01', 'dd-one'),
  ('10000000-0000-0000-0000-00000000dd02', '00000000-0000-0000-0000-00000000dd02', 'dd-two');

insert into public.book_members (book_id, email, user_id) values
  ('10000000-0000-0000-0000-00000000dd01', 'dd-member@test.dev', '00000000-0000-0000-0000-00000000dd03');

insert into public.contacts (id, book_id, full_name) values
  ('20000000-0000-0000-0000-00000000dd01', '10000000-0000-0000-0000-00000000dd01', 'Theo'),
  ('20000000-0000-0000-0000-00000000dd02', '10000000-0000-0000-0000-00000000dd01', 'Nina'),
  ('20000000-0000-0000-0000-00000000dd03', '10000000-0000-0000-0000-00000000dd02', 'Other Book');

create or replace function tests.authenticate_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid, true);
  execute 'set local role authenticated';
end $$;

select tests.authenticate_as('00000000-0000-0000-0000-00000000dd01');
select lives_ok(
  $$ insert into public.contact_duplicate_dismissals (book_id, contact_a, contact_b) values
     ('10000000-0000-0000-0000-00000000dd01',
      '20000000-0000-0000-0000-00000000dd01', '20000000-0000-0000-0000-00000000dd02') $$,
  'an owner can dismiss a pair in their book');
select throws_ok(
  $$ insert into public.contact_duplicate_dismissals (book_id, contact_a, contact_b) values
     ('10000000-0000-0000-0000-00000000dd01',
      '20000000-0000-0000-0000-00000000dd02', '20000000-0000-0000-0000-00000000dd01') $$,
  '23514', null, 'a pair is stored in one order only');
select throws_ok(
  $$ insert into public.contact_duplicate_dismissals (book_id, contact_a, contact_b) values
     ('10000000-0000-0000-0000-00000000dd01',
      '20000000-0000-0000-0000-00000000dd01', '20000000-0000-0000-0000-00000000dd03') $$,
  '42501', null, 'a pair cannot reach into another book');
reset role;

select tests.authenticate_as('00000000-0000-0000-0000-00000000dd03');
select results_eq('select count(*) from public.contact_duplicate_dismissals', array[1::bigint],
  'a book member sees the dismissal');
reset role;

select tests.authenticate_as('00000000-0000-0000-0000-00000000dd02');
select results_eq('select count(*) from public.contact_duplicate_dismissals', array[0::bigint],
  'another owner sees nothing');
select throws_ok(
  $$ delete from public.contact_duplicate_dismissals $$,
  '42501', null, 'dismissals cannot be deleted by clients');
reset role;

delete from public.contacts where id = '20000000-0000-0000-0000-00000000dd02';
select is_empty('select 1 from public.contact_duplicate_dismissals',
  'deleting a contact removes its dismissals');

select * from finish();
rollback;
