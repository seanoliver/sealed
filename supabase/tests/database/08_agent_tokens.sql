begin;
create schema if not exists tests;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000a7001', 'at-owner@test.dev'),
  ('00000000-0000-4000-8000-0000000a7002', 'at-other@test.dev');

insert into public.agent_tokens (id, user_id, name, token_hash, scopes, created_at, last_used_at, expires_at, revoked_at) values
  ('30000000-0000-4000-8000-0000000a7001', '00000000-0000-4000-8000-0000000a7001', 'live',
   extensions.digest('live', 'sha256'), '{read}', now(), null, null, null),
  ('30000000-0000-4000-8000-0000000a7002', '00000000-0000-4000-8000-0000000a7001', 'expired',
   extensions.digest('expired', 'sha256'), '{read}', now() - interval '2 days', null, now() - interval '1 day', null),
  ('30000000-0000-4000-8000-0000000a7003', '00000000-0000-4000-8000-0000000a7001', 'revoked',
   extensions.digest('revoked', 'sha256'), '{read}', now(), null, null, now()),
  ('30000000-0000-4000-8000-0000000a7004', '00000000-0000-4000-8000-0000000a7002', 'other',
   extensions.digest('other', 'sha256'), '{read,write}', now(), now() - interval '10 seconds', null, null);

create or replace function tests.authenticate_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid, true);
  execute 'set local role authenticated';
end $$;

select throws_ok($$
  insert into public.agent_tokens (user_id, name, token_hash, scopes)
  values ('00000000-0000-4000-8000-0000000a7001', 'x', extensions.digest('a', 'sha256'), '{admin}')
$$, '23514', null, 'scopes outside read/write/send are refused');
select throws_ok($$
  insert into public.agent_tokens (user_id, name, token_hash, scopes)
  values ('00000000-0000-4000-8000-0000000a7001', 'x', extensions.digest('b', 'sha256'), '{}')
$$, '23514', null, 'a token needs at least one scope');
select throws_ok($$
  insert into public.agent_tokens (user_id, name, token_hash, scopes)
  values ('00000000-0000-4000-8000-0000000a7001', 'x', '\xdeadbeef', '{read}')
$$, '23514', null, 'the hash is a 32-byte sha256');
select throws_ok($$
  insert into public.agent_tokens (user_id, name, token_hash, scopes)
  values ('00000000-0000-4000-8000-0000000a7001', 'x', extensions.digest('live', 'sha256'), '{read}')
$$, '23505', null, 'token hashes are unique');

select results_eq($$
  select token_id, user_id, scopes from private.verify_agent_token(extensions.digest('live', 'sha256'))
$$, $$ values ('30000000-0000-4000-8000-0000000a7001'::uuid, '00000000-0000-4000-8000-0000000a7001'::uuid, '{read}'::text[]) $$,
  'a live token resolves to its owner');
select isnt((select last_used_at from public.agent_tokens where name = 'live'), null,
  'verifying records the last use');
select is_empty($$ select * from private.verify_agent_token(extensions.digest('expired', 'sha256')) $$,
  'an expired token does not verify');
select is_empty($$ select * from private.verify_agent_token(extensions.digest('revoked', 'sha256')) $$,
  'a revoked token does not verify');
select is_empty($$ select * from private.verify_agent_token(extensions.digest('unknown', 'sha256')) $$,
  'an unknown token does not verify');
select ok((select last_used_at < now() - interval '5 seconds' from public.agent_tokens where name = 'other')
  and exists (select 1 from private.verify_agent_token(extensions.digest('other', 'sha256')))
  and (select last_used_at < now() - interval '5 seconds' from public.agent_tokens where name = 'other'),
  'last use is recorded at most once a minute');

select tests.authenticate_as('00000000-0000-4000-8000-0000000a7001');

select results_eq($$ select name from public.agent_tokens order by name $$,
  $$ values ('expired'), ('live'), ('revoked') $$, 'owners list only their own tokens');
select throws_ok($$ select token_hash from public.agent_tokens $$, '42501', null,
  'token hashes are unreadable');
select throws_ok($$
  insert into public.agent_tokens (user_id, name, token_hash, scopes)
  values ('00000000-0000-4000-8000-0000000a7001', 'mine', extensions.digest('mine', 'sha256'), '{read}')
$$, '42501', null, 'owners cannot insert tokens directly');
select throws_ok($$ update public.agent_tokens set name = 'renamed' $$, '42501', null,
  'only revoked_at is writable');
select throws_ok($$ delete from public.agent_tokens $$, '42501', null, 'tokens cannot be deleted');
select throws_ok($$ select * from private.verify_agent_token('\x00') $$, '42501', null,
  'clients cannot call the verifier');

select results_eq($$
  update public.agent_tokens set revoked_at = now() where name in ('live', 'other') returning name
$$, $$ values ('live') $$, 'owners revoke their own tokens and no one else''s');
select is_empty($$
  update public.agent_tokens set revoked_at = null where name = 'live' returning name
$$, 'a revoked token cannot be restored');

reset role;
select is((select revoked_at is null from public.agent_tokens where name = 'other'), true,
  'the other owner''s token is untouched');

select * from finish();
rollback;
