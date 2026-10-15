begin;
create schema if not exists tests;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- Parity fixture shared with src/lib/names.test.ts, which parses the
-- dollar-quoted literal below. Keep it valid JSON.
create temp table fixture as select $fixture${
  "person": [
    { "first": "Jane", "last": "Smith", "expected": "Jane Smith" },
    { "first": "Mary Ann", "last": "Smith", "expected": "Mary Ann Smith" },
    { "first": "Cher", "last": null, "expected": "Cher" },
    { "first": null, "last": "Smith", "expected": "Smith" },
    { "first": "", "last": "Smith", "expected": "Smith" },
    { "first": null, "last": null, "expected": null }
  ],
  "kids": [
    { "kids": [{ "first": "Zoe", "last": "Smith" }, { "first": "Max", "last": "Smith" }], "family_last": "Smith", "expected": "Zoe, Max" },
    { "kids": [{ "first": "Zoe", "last": "Smith" }, { "first": "Max", "last": "Jones" }], "family_last": "Smith", "expected": "Zoe, Max Jones" },
    { "kids": [{ "first": "Zoe" }, { "first": "Max", "last": "" }], "family_last": "Smith", "expected": "Zoe, Max" },
    { "kids": [{ "first": "Zoe", "last": "Smith" }], "family_last": null, "expected": "Zoe Smith" },
    { "kids": [{ "first": "Zoe", "last": "smith" }], "family_last": "Smith", "expected": "Zoe smith" },
    { "kids": [{ "first": "Ana Sofia", "last": "de la Cruz" }], "family_last": "Cruz", "expected": "Ana Sofia de la Cruz" },
    { "kids": null, "family_last": "Smith", "expected": null }
  ]
}$fixture$::jsonb as data;

select is(
  (select jsonb_agg(to_jsonb(private.format_person(c ->> 'first', c ->> 'last')) order by n)
   from fixture, jsonb_array_elements(data -> 'person') with ordinality as t(c, n)),
  (select jsonb_agg(c -> 'expected' order by n)
   from fixture, jsonb_array_elements(data -> 'person') with ordinality as t(c, n)),
  'format_person matches the shared fixture');
select is(
  (select jsonb_agg(to_jsonb(private.format_kids(nullif(c -> 'kids', 'null'), c ->> 'family_last')) order by n)
   from fixture, jsonb_array_elements(data -> 'kids') with ordinality as t(c, n)),
  (select jsonb_agg(c -> 'expected' order by n)
   from fixture, jsonb_array_elements(data -> 'kids') with ordinality as t(c, n)),
  'format_kids matches the shared fixture');

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'names@test.dev');
insert into public.books (id, owner_id, slug, enabled_fields) values
  ('10000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'names-book',
   '{"partner_name": true, "kids_names": true, "birthday": false}');

insert into public.contacts (id, book_id, full_name, first_name, last_name,
  partner_first_name, partner_last_name, kids) values
  ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1',
   'placeholder', 'Jane', 'Smith', 'Sam', 'Lee',
   '[{"first": "Zoe", "last": "Smith"}, {"first": "Max", "last": "Jones"}]');
select results_eq(
  $$ select full_name, partner_name, kids_names from public.contacts
     where id = '20000000-0000-0000-0000-0000000000c1' $$,
  $$ values ('Jane Smith', 'Sam Lee', 'Zoe, Max Jones') $$,
  'insert derives every display string from its structured group');

insert into public.contacts (id, book_id, full_name, partner_name, kids_names) values
  ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000c1',
   'Old Style', 'Pat', 'A, B and C');
select results_eq(
  $$ select full_name, partner_name, kids_names, first_name, kids from public.contacts
     where id = '20000000-0000-0000-0000-0000000000c2' $$,
  $$ values ('Old Style', 'Pat', 'A, B and C', null::text, null::jsonb) $$,
  'legacy insert keeps display strings and leaves structured fields null');

update public.contacts set first_name = 'Janet', full_name = 'stale'
where id = '20000000-0000-0000-0000-0000000000c1';
select results_eq(
  $$ select full_name from public.contacts where id = '20000000-0000-0000-0000-0000000000c1' $$,
  $$ values ('Janet Smith') $$,
  'a structured change wins over a display string written in the same update');

update public.contacts set last_name = 'Jones'
where id = '20000000-0000-0000-0000-0000000000c1';
select results_eq(
  $$ select full_name, kids_names from public.contacts
     where id = '20000000-0000-0000-0000-0000000000c1' $$,
  $$ values ('Janet Jones', 'Zoe Smith, Max') $$,
  'kids display follows the contact''s last name');

update public.contacts set partner_name = 'Samantha'
where id = '20000000-0000-0000-0000-0000000000c1';
select results_eq(
  $$ select partner_name, partner_first_name, partner_last_name, first_name, kids is not null
     from public.contacts where id = '20000000-0000-0000-0000-0000000000c1' $$,
  $$ values ('Samantha', null::text, null::text, 'Janet', true) $$,
  'editing partner_name clears the partner group only');

update public.contacts set kids_names = 'Zoe and Max'
where id = '20000000-0000-0000-0000-0000000000c1';
select results_eq(
  $$ select kids_names, kids from public.contacts
     where id = '20000000-0000-0000-0000-0000000000c1' $$,
  $$ values ('Zoe and Max', null::jsonb) $$,
  'editing kids_names clears kids');

update public.contacts set full_name = 'J. Jones'
where id = '20000000-0000-0000-0000-0000000000c1';
select results_eq(
  $$ select full_name, first_name, last_name from public.contacts
     where id = '20000000-0000-0000-0000-0000000000c1' $$,
  $$ values ('J. Jones', null::text, null::text) $$,
  'editing full_name clears first and last name');

insert into public.contacts (id, book_id, full_name, first_name, last_name, kids) values
  ('20000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-0000000000c1',
   'x', 'Ann', 'Lee', '[{"first": "Bo", "last": "Lee"}]');
update public.contacts set city = 'Elsewhere'
where id = '20000000-0000-0000-0000-0000000000c3';
select results_eq(
  $$ select full_name, kids_names, first_name, kids from public.contacts
     where id = '20000000-0000-0000-0000-0000000000c3' $$,
  $$ values ('Ann Lee', 'Bo', 'Ann', '[{"first": "Bo", "last": "Lee"}]'::jsonb) $$,
  'an unrelated update keeps names in sync');

insert into public.update_tokens (contact_id, token_hash, expires_at) values
  ('20000000-0000-0000-0000-0000000000c3', extensions.digest('namestoken', 'sha256'), now() + interval '1 day'),
  ('20000000-0000-0000-0000-0000000000c3', extensions.digest('namestoken2', 'sha256'), now() + interval '1 day');
select ok(private.apply_token_update('namestoken',
  '{"full_name": "Ann Lee", "kids_names": "Bo", "city": "Thirdtown"}'),
  'token update with unchanged names succeeds');
select results_eq(
  $$ select first_name, last_name, kids from public.contacts
     where id = '20000000-0000-0000-0000-0000000000c3' $$,
  $$ values ('Ann', 'Lee', '[{"first": "Bo", "last": "Lee"}]'::jsonb) $$,
  'a token update that repeats the display strings keeps structured fields');
select ok(private.apply_token_update('namestoken2', '{"full_name": "Annie Lee"}'),
  'token update with a new name succeeds');
select results_eq(
  $$ select full_name, first_name, last_name from public.contacts
     where id = '20000000-0000-0000-0000-0000000000c3' $$,
  $$ values ('Annie Lee', null::text, null::text) $$,
  'a token update that edits full_name clears first and last name');

select ok(private.valid_kids(
  (select jsonb_agg(jsonb_build_object('first', 'K' || i)) from generate_series(1, 10) i)),
  'valid_kids accepts 10 kids');
select throws_ok(
  $$ update public.contacts set kids =
       (select jsonb_agg(jsonb_build_object('first', 'K' || i)) from generate_series(1, 11) i)
     where id = '20000000-0000-0000-0000-0000000000c3' $$,
  '23514', null, 'valid_kids rejects 11 kids');
select throws_ok(
  $$ update public.contacts set kids = '["Zoe"]'
     where id = '20000000-0000-0000-0000-0000000000c3' $$,
  '23514', null, 'valid_kids rejects non-object items');
select throws_ok(
  $$ update public.contacts set kids = '[{"first": "Zoe", "middle": "Q"}]'
     where id = '20000000-0000-0000-0000-0000000000c3' $$,
  '23514', null, 'valid_kids rejects extra keys');
select throws_ok(
  $$ update public.contacts set first_name = repeat('x', 81)
     where id = '20000000-0000-0000-0000-0000000000c3' $$,
  '23514', null, 'first_name is capped at 80 characters');
select lives_ok(
  $$ update public.contacts set kids = null, kids_names = repeat('k', 2000)
     where id = '20000000-0000-0000-0000-0000000000c3' $$,
  'kids_names accepts 2000 characters');
select throws_ok(
  $$ update public.contacts set kids_names = repeat('k', 2001)
     where id = '20000000-0000-0000-0000-0000000000c3' $$,
  '23514', null, 'kids_names is capped at 2000 characters');

create or replace function tests.authenticate_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid, true);
  execute 'set local role authenticated';
end $$;
select tests.authenticate_as('00000000-0000-0000-0000-0000000000c1');
insert into public.contacts (book_id, full_name, first_name, last_name, kids) values
  ('10000000-0000-0000-0000-0000000000c1', 'x', 'Owen', 'Park', '[{"first": "Ivy", "last": "Park"}]');
select results_eq(
  $$ select full_name, kids_names from public.contacts where first_name = 'Owen' $$,
  $$ values ('Owen Park', 'Ivy') $$,
  'an authenticated owner insert derives names');
reset role;

select * from finish();
rollback;
