begin;
create schema if not exists tests;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- fixtures: two users, two books, one contact each
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner1@test.dev'),
  ('00000000-0000-0000-0000-000000000002', 'owner2@test.dev');

insert into public.books (id, owner_id, slug) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'book-one'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'book-two');

insert into public.contacts (id, book_id, full_name, email) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Alice A', 'alice@test.dev'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Bob B', 'bob@test.dev');

insert into public.update_tokens (contact_id, token_hash, expires_at) values
  ('20000000-0000-0000-0000-000000000001', '\xdeadbeef', now() + interval '30 days');

-- read-only-table fixtures (inserted as postgres, bypassing RLS): one
-- email_send, one contact_event, one pending submission — all owner1's
insert into public.email_sends (contact_id, book_id) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
insert into public.contact_events (contact_id, source, diff) values
  ('20000000-0000-0000-0000-000000000001', 'owner', '{}');
insert into public.submissions (book_id, payload) values
  ('10000000-0000-0000-0000-000000000001', '{"full_name": "Pending P"}');

-- helper to impersonate
create or replace function tests.authenticate_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid, true);
  execute 'set local role authenticated';
end $$;

-- title-free identity and new-book defaults
select has_column('public', 'profiles', 'display_name',
  'profiles expose display_name');
select hasnt_column('public', 'profiles', 'full_name',
  'profiles no longer expose full_name');
select hasnt_column('public', 'books', 'title',
  'address books have no independent title');
select results_eq(
  $$ select enabled_fields from public.books
     where id = '10000000-0000-0000-0000-000000000001' $$,
  $$ values ('{"partner_name": false, "kids_names": false, "birthday": false}'::jsonb) $$,
  'new address books default all optional invite fields off');

-- 1. structural guardrail: every public table has RLS enabled
select is_empty(
  $$ select tablename from pg_tables where schemaname = 'public' and rowsecurity = false $$,
  'every table in public has RLS enabled');

-- 2. structural guardrail: no residual non-DML privileges for client roles.
-- RLS does NOT apply to TRUNCATE; Supabase default ACLs historically leave
-- TRUNCATE/REFERENCES/TRIGGER/MAINTAIN granted. Must be zero, always.
select is_empty(
  $$ select c.relname, a.privilege_type
     from pg_class c
     cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     join pg_roles r on r.oid = a.grantee
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
       and r.rolname in ('anon', 'authenticated')
       and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN') $$,
  'client roles hold no TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on any public table');

-- 3. update_tokens: zero privileges of any kind for client roles
select ok(
  not has_table_privilege('authenticated', 'public.update_tokens', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  and not has_table_privilege('anon', 'public.update_tokens', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'update_tokens grants nothing to client roles');

-- 4. structural guardrail: client-role grants match the migration's grants
-- block EXACTLY. A future stray grant (or a dropped one) shows up as a
-- named "unexpected:"/"missing:" row in the failure output.
select is_empty(
  $$ with actual (tbl, rol, priv) as (
       select c.relname::text, r.rolname::text, a.privilege_type::text
       from pg_class c
       cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       join pg_roles r on r.oid = a.grantee
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
         and r.rolname in ('anon', 'authenticated')),
     expected (tbl, rol, priv) as (values
       ('profiles',       'authenticated', 'SELECT'),
       ('profiles',       'authenticated', 'UPDATE'),
       ('books',          'authenticated', 'SELECT'),
       ('books',          'authenticated', 'INSERT'),
       ('books',          'authenticated', 'UPDATE'),
       ('books',          'authenticated', 'DELETE'),
       ('contacts',       'authenticated', 'SELECT'),
       ('contacts',       'authenticated', 'INSERT'),
       ('contacts',       'authenticated', 'UPDATE'),
       ('contacts',       'authenticated', 'DELETE'),
       ('submissions',    'authenticated', 'SELECT'),
       ('submissions',    'authenticated', 'UPDATE'),
       ('submissions',    'authenticated', 'DELETE'),
       ('email_sends',    'authenticated', 'SELECT'),
       ('contact_events', 'authenticated', 'SELECT'),
       ('agent_previews', 'authenticated', 'SELECT'))
     select 'unexpected: ' || tbl || ' ' || rol || ' ' || priv
       from (select * from actual except select * from expected) u
     union all
     select 'missing: ' || tbl || ' ' || rol || ' ' || priv
       from (select * from expected except select * from actual) m $$,
  'client-role grants match the exact expected matrix');

-- as owner1
select tests.authenticate_as('00000000-0000-0000-0000-000000000001');
select results_eq('select count(*) from public.contacts', array[1::bigint], 'owner1 sees exactly own contact');
select results_eq('select full_name from public.contacts', array['Alice A'], 'owner1 sees Alice not Bob');
select results_eq('select count(*) from public.books', array[1::bigint], 'owner1 sees one book');
-- no grant at all, so even SELECT errors (stronger than RLS row-filtering)
select throws_ok('select count(*) from public.update_tokens', '42501', null,
  'update_tokens not selectable even by owner');
select results_eq('select count(*) from public.profiles', array[1::bigint], 'owner1 sees only own profile');
select results_eq('select count(*) from public.email_sends', array[1::bigint], 'owner1 sees own email_send');
select results_eq('select count(*) from public.contact_events', array[1::bigint], 'owner1 sees own contact_event');
-- WITH CHECK probes: UPDATEs that pass USING but land rows outside the policy
select throws_ok(
  $$ update public.contacts set book_id = '10000000-0000-0000-0000-000000000002'
     where id = '20000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'owner cannot move a contact into another owner''s book');
select throws_ok(
  $$ update public.books set owner_id = '00000000-0000-0000-0000-000000000002'
     where id = '10000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'owner cannot give a book away');
select throws_ok(
  $$ insert into public.contacts (book_id, full_name)
     values ('10000000-0000-0000-0000-000000000002', 'Sneaky') $$,
  '42501', null, 'owner1 cannot insert into owner2''s book');
select throws_ok(
  $$ insert into public.submissions (book_id, payload)
     values ('10000000-0000-0000-0000-000000000001', '{}') $$,
  '42501', null, 'even owner cannot insert submissions directly');
select throws_ok(
  $$ insert into public.update_tokens (contact_id, token_hash, expires_at)
     values ('20000000-0000-0000-0000-000000000001', '\xff', now()) $$,
  '42501', null, 'authenticated cannot mint tokens');

-- as owner2 (reset role first: authenticated has no USAGE on schema tests)
reset role;
select tests.authenticate_as('00000000-0000-0000-0000-000000000002');
select results_eq('select full_name from public.contacts', array['Bob B'], 'owner2 sees Bob not Alice');
select is_empty(
  $$ update public.contacts set full_name = 'pwned'
     where id = '20000000-0000-0000-0000-000000000001' returning id $$,
  'owner2 cannot update owner1''s contact');
select results_eq('select count(*) from public.email_sends', array[0::bigint], 'owner2 sees no email_sends of owner1');
select results_eq('select count(*) from public.contact_events', array[0::bigint], 'owner2 sees no contact_events of owner1');
select is_empty(
  $$ update public.submissions set status = 'approved'
     where book_id = '10000000-0000-0000-0000-000000000001' returning id $$,
  'owner2 cannot approve owner1''s submissions');
select is_empty(
  $$ delete from public.submissions
     where book_id = '10000000-0000-0000-0000-000000000001' returning id $$,
  'owner2 cannot delete owner1''s submissions');

-- as anon (anon holds zero grants, so even SELECT errors)
reset role;
set local role anon;
select throws_ok('select count(*) from public.contacts', '42501', null,
  'anon cannot even select contacts');

select * from finish();
rollback;
