begin;
create schema if not exists tests;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000a8001', 'ac-owner@test.dev'),
  ('00000000-0000-4000-8000-0000000a8002', 'ac-other@test.dev');
insert into public.books (id, owner_id, slug) values
  ('10000000-0000-4000-8000-0000000a8001', '00000000-0000-4000-8000-0000000a8001', 'ac-book'),
  ('10000000-0000-4000-8000-0000000a8002', '00000000-0000-4000-8000-0000000a8002', 'ac-other');
insert into public.contacts (id, book_id, full_name) values
  ('20000000-0000-4000-8000-0000000a8001', '10000000-0000-4000-8000-0000000a8001', 'Ana'),
  ('20000000-0000-4000-8000-0000000a8002', '10000000-0000-4000-8000-0000000a8002', 'Other');
insert into public.agent_tokens (id, user_id, name, token_hash, scopes) values
  ('30000000-0000-4000-8000-0000000a8001', '00000000-0000-4000-8000-0000000a8001', 'mine',
   extensions.digest('ac-mine', 'sha256'), '{read,write}'),
  ('30000000-0000-4000-8000-0000000a8002', '00000000-0000-4000-8000-0000000a8002', 'theirs',
   extensions.digest('ac-theirs', 'sha256'), '{write}');
insert into public.agent_previews (id, user_id, agent_token_id, kind, items, expires_at) values
  ('40000000-0000-4000-8000-0000000a8001', '00000000-0000-4000-8000-0000000a8001',
   '30000000-0000-4000-8000-0000000a8001', 'update', '[{"id": "x"}]', now() + interval '30 minutes'),
  ('40000000-0000-4000-8000-0000000a8002', '00000000-0000-4000-8000-0000000a8002',
   '30000000-0000-4000-8000-0000000a8002', 'delete', '[{"id": "y"}]', now() + interval '30 minutes');

create or replace function tests.authenticate_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid, true);
  execute 'set local role authenticated';
end $$;

select lives_ok($$
  insert into public.contact_events (contact_id, source, diff, agent_token_id, agent_preview_id, contact_updated_at)
  values ('20000000-0000-4000-8000-0000000a8001', 'agent', '{"before": {}, "after": {}}',
    '30000000-0000-4000-8000-0000000a8001', '40000000-0000-4000-8000-0000000a8001', now())
$$, 'an agent event carries its token, preview and the contact''s updated_at');
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
  values ('00000000-0000-4000-8000-0000000a8001', '30000000-0000-4000-8000-0000000a8001', 'update', '[]',
    now() + interval '1 minute')
$$, '23514', null, 'a preview holds at least one item');
select throws_ok($$
  insert into public.agent_previews (user_id, agent_token_id, kind, items, expires_at)
  values ('00000000-0000-4000-8000-0000000a8001', '30000000-0000-4000-8000-0000000a8001', 'update',
    (select jsonb_agg(g) from generate_series(1, 501) g), now() + interval '1 minute')
$$, '23514', null, 'a preview holds at most 500 items');
select throws_ok($$
  insert into public.agent_previews (user_id, agent_token_id, kind, items, expires_at)
  values ('00000000-0000-4000-8000-0000000a8001', '30000000-0000-4000-8000-0000000a8001', 'merge', '[1]',
    now() + interval '1 minute')
$$, '23514', null, 'a preview is an update or a delete');
select throws_ok($$
  update public.agent_previews set requested_at = now() where id = '40000000-0000-4000-8000-0000000a8001'
$$, '23514', null, 'only a delete waits for the owner');
select throws_ok($$
  update public.agent_previews set applied_at = now(), discarded_at = now()
  where id = '40000000-0000-4000-8000-0000000a8002'
$$, '23514', null, 'a preview is applied or discarded, not both');
select lives_ok($$
  update public.agent_previews set requested_at = now(), discarded_at = now()
  where id = '40000000-0000-4000-8000-0000000a8002'
$$, 'an owner can discard a requested delete');

select tests.authenticate_as('00000000-0000-4000-8000-0000000a8001');

select results_eq($$ select id from public.agent_previews $$,
  $$ values ('40000000-0000-4000-8000-0000000a8001'::uuid) $$, 'owners read only their own previews');
select throws_ok($$
  insert into public.agent_previews (user_id, agent_token_id, kind, items, expires_at)
  values ('00000000-0000-4000-8000-0000000a8001', '30000000-0000-4000-8000-0000000a8001', 'update', '[1]',
    now() + interval '1 minute')
$$, '42501', null, 'owners cannot write previews');
select throws_ok($$ update public.agent_previews set applied_at = now() $$, '42501', null,
  'owners cannot mark a preview applied');
select throws_ok($$
  insert into public.contact_events (contact_id, source, diff)
  values ('20000000-0000-4000-8000-0000000a8001', 'agent', '{}')
$$, '42501', null, 'owners cannot forge agent events');
select results_eq($$ select agent_token_id from public.contact_events where source = 'agent' $$,
  $$ values ('30000000-0000-4000-8000-0000000a8001'::uuid) $$, 'owners read their agent events');

reset role;
delete from public.agent_previews where id = '40000000-0000-4000-8000-0000000a8001';
select is((select agent_preview_id from public.contact_events where source = 'agent'
  and contact_id = '20000000-0000-4000-8000-0000000a8001'),
  '40000000-0000-4000-8000-0000000a8001'::uuid,
  'pruning a preview keeps its events and their grouping');
select lives_ok($$ delete from auth.users where id = '00000000-0000-4000-8000-0000000a8001' $$,
  'deleting an owner removes their contacts, tokens, previews and agent events together');
select is((select count(*)::int from public.contact_events
  where contact_id = '20000000-0000-4000-8000-0000000a8001'), 0,
  'no agent event outlives its owner');

select * from finish();
rollback;
