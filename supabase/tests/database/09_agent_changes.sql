begin;
create schema if not exists tests;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000a8001', 'ac-owner@test.dev'),
  ('00000000-0000-4000-8000-0000000a8002', 'ac-other@test.dev');
insert into public.books (id, owner_id, slug) values
  ('10000000-0000-4000-8000-0000000a8001', '00000000-0000-4000-8000-0000000a8001', 'ac-book'),
  ('10000000-0000-4000-8000-0000000a8002', '00000000-0000-4000-8000-0000000a8002', 'ac-other');
insert into public.contacts (id, book_id, full_name) values
  ('20000000-0000-4000-8000-0000000a8001', '10000000-0000-4000-8000-0000000a8001', 'Ana'),
  ('20000000-0000-4000-8000-0000000a8002', '10000000-0000-4000-8000-0000000a8002', 'Other');
insert into public.agent_tokens (id, user_id, name, token_hash, scopes, revoked_at) values
  ('30000000-0000-4000-8000-0000000a8001', '00000000-0000-4000-8000-0000000a8001', 'mine',
   extensions.digest('ac-mine', 'sha256'), '{read,write}', null),
  ('30000000-0000-4000-8000-0000000a8002', '00000000-0000-4000-8000-0000000a8002', 'theirs',
   extensions.digest('ac-theirs', 'sha256'), '{write}', null),
  ('30000000-0000-4000-8000-0000000a8003', '00000000-0000-4000-8000-0000000a8001', 'revoked',
   extensions.digest('ac-revoked', 'sha256'), '{write}', now());
insert into public.agent_previews (id, user_id, agent_token_id, kind, items, expires_at, requested_at) values
  ('40000000-0000-4000-8000-0000000a8001', '00000000-0000-4000-8000-0000000a8001',
   '30000000-0000-4000-8000-0000000a8001', 'delete', '[{"id": "x"}]', now() + interval '7 days', now()),
  ('40000000-0000-4000-8000-0000000a8002', '00000000-0000-4000-8000-0000000a8002',
   '30000000-0000-4000-8000-0000000a8002', 'delete', '[{"id": "y"}]', now() + interval '7 days', now()),
  ('40000000-0000-4000-8000-0000000a8003', '00000000-0000-4000-8000-0000000a8001',
   '30000000-0000-4000-8000-0000000a8001', 'delete', '[{"id": "z"}]', now() + interval '30 minutes', null);

create or replace function tests.authenticate_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid, true);
  execute 'set local role authenticated';
end $$;

select throws_ok($$
  insert into public.contact_events (contact_id, source, diff, agent_token_id)
  values ('20000000-0000-4000-8000-0000000a8001', 'owner', '{}', '30000000-0000-4000-8000-0000000a8001')
$$, '23514', null, 'only agent events name a token');
select throws_ok($$
  insert into public.contact_events (contact_id, source, diff, contact_updated_at)
  values ('20000000-0000-4000-8000-0000000a8001', 'submission', '{}', now())
$$, '23514', null, 'only agent events record updated_at');
select throws_ok($$
  insert into public.contact_events (contact_id, source, diff)
  values ('20000000-0000-4000-8000-0000000a8001', 'robot', '{}')
$$, '23514', null, 'sources stay a closed list');
select throws_ok($$
  insert into public.agent_previews (user_id, agent_token_id, kind, items, expires_at)
  values ('00000000-0000-4000-8000-0000000a8001', '30000000-0000-4000-8000-0000000a8001', 'delete', '[]',
    now() + interval '1 minute')
$$, '23514', null, 'a request holds at least one item');
select throws_ok($$
  insert into public.agent_previews (user_id, agent_token_id, kind, items, expires_at)
  values ('00000000-0000-4000-8000-0000000a8001', '30000000-0000-4000-8000-0000000a8001', 'delete',
    (select jsonb_agg(g) from generate_series(1, 501) g), now() + interval '1 minute')
$$, '23514', null, 'a request holds at most 500 items');
select throws_ok($$
  insert into public.agent_previews (user_id, agent_token_id, kind, items, expires_at)
  values ('00000000-0000-4000-8000-0000000a8001', '30000000-0000-4000-8000-0000000a8001', 'update', '[1]',
    now() + interval '1 minute')
$$, '23514', null, 'a request is a delete or an email change');
select throws_ok($$
  update public.agent_previews set applied_at = now(), discarded_at = now()
  where id = '40000000-0000-4000-8000-0000000a8002'
$$, '23514', null, 'a request is applied or discarded, not both');

select tests.authenticate_as('00000000-0000-4000-8000-0000000a8001');

select lives_ok($$
  insert into public.contact_events (contact_id, source, diff, agent_token_id, contact_updated_at)
  values ('20000000-0000-4000-8000-0000000a8001', 'agent', '{"before": {}, "after": {}}',
    '30000000-0000-4000-8000-0000000a8001',
    (select updated_at from public.contacts where id = '20000000-0000-4000-8000-0000000a8001'))
$$, 'an owner records an agent event for their own token, stamped with the contact''s updated_at');
select throws_ok($$
  insert into public.contact_events (contact_id, source, diff, agent_token_id, contact_updated_at)
  values ('20000000-0000-4000-8000-0000000a8001', 'agent', '{}', '30000000-0000-4000-8000-0000000a8001',
    now() - interval '1 day')
$$, '42501', null, 'the stamp must be the contact''s current updated_at');
select throws_ok($$
  insert into public.contact_events (contact_id, source, diff, agent_token_id, contact_updated_at)
  values ('20000000-0000-4000-8000-0000000a8001', 'agent', '{}', '30000000-0000-4000-8000-0000000a8003',
    (select updated_at from public.contacts where id = '20000000-0000-4000-8000-0000000a8001'))
$$, '42501', null, 'a revoked token records nothing');
select throws_ok($$
  insert into public.contact_events (contact_id, source, diff, agent_token_id, contact_updated_at)
  values ('20000000-0000-4000-8000-0000000a8001', 'agent', '{}', '30000000-0000-4000-8000-0000000a8002', now())
$$, '42501', null, 'another owner''s token records nothing');
select throws_ok($$
  insert into public.contact_events (contact_id, source, diff)
  values ('20000000-0000-4000-8000-0000000a8001', 'owner', '{}')
$$, '42501', null, 'owner events still come only from the server');
select throws_ok($$
  insert into public.contact_events (contact_id, source, diff, created_at)
  values ('20000000-0000-4000-8000-0000000a8001', 'agent', '{}', now() - interval '1 year')
$$, '42501', null, 'agent events cannot be backdated');

select results_eq($$ select id from public.agent_previews order by id $$,
  $$ values ('40000000-0000-4000-8000-0000000a8001'::uuid), ('40000000-0000-4000-8000-0000000a8003'::uuid) $$,
  'owners read only their own requests');
select lives_ok($$
  insert into public.agent_previews (user_id, agent_token_id, kind, items, requested_at, expires_at)
  values ('00000000-0000-4000-8000-0000000a8001', '30000000-0000-4000-8000-0000000a8001', 'email', '[1]',
    now(), now() + interval '7 days')
$$, 'an agent''s email change is queued in the owner''s session');
select throws_ok($$
  insert into public.agent_previews (user_id, agent_token_id, kind, items, requested_at, expires_at)
  values ('00000000-0000-4000-8000-0000000a8001', '30000000-0000-4000-8000-0000000a8001', 'delete', '[1]',
    now(), now() + interval '7 days')
$$, '42501', null, 'deletions are not queued from the owner''s session');
select throws_ok($$
  insert into public.agent_previews (user_id, agent_token_id, kind, items, requested_at, expires_at)
  values ('00000000-0000-4000-8000-0000000a8001', '30000000-0000-4000-8000-0000000a8003', 'email', '[1]',
    now(), now() + interval '7 days')
$$, '42501', null, 'a revoked token queues nothing');
select results_eq($$
  update public.agent_previews set discarded_at = now() where id = '40000000-0000-4000-8000-0000000a8001'
  returning id
$$, $$ values ('40000000-0000-4000-8000-0000000a8001'::uuid) $$, 'an owner discards their open request');
select is_empty($$
  update public.agent_previews set applied_at = now() where id = '40000000-0000-4000-8000-0000000a8001'
  returning id
$$, 'a finished request stays finished');
select is_empty($$
  update public.agent_previews set applied_at = now() where id = '40000000-0000-4000-8000-0000000a8003'
  returning id
$$, 'an owner cannot resolve a preview the agent never sent');
select throws_ok($$ update public.agent_previews set expires_at = now() + interval '1 year' $$,
  '42501', null, 'owners cannot extend a request');
select results_eq($$ select agent_token_id from public.contact_events where source = 'agent' $$,
  $$ values ('30000000-0000-4000-8000-0000000a8001'::uuid) $$, 'owners read their agent events');

reset role;
delete from public.agent_previews where user_id = '00000000-0000-4000-8000-0000000a8001';
select is((select count(*)::int from public.contact_events
  where contact_id = '20000000-0000-4000-8000-0000000a8001'), 1,
  'pruning requests keeps the history they produced');
select lives_ok($$ delete from auth.users where id = '00000000-0000-4000-8000-0000000a8001' $$,
  'deleting an owner removes their contacts, tokens, requests and agent events together');
select is((select count(*)::int from public.contact_events
  where contact_id = '20000000-0000-4000-8000-0000000a8001'), 0,
  'no agent event outlives its owner');

select * from finish();
rollback;
