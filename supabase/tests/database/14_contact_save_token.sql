begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000007f001', 'st@test.dev');
insert into public.books (id, owner_id, slug, enabled_fields)
values ('10000000-0000-4000-8000-00000007f001', '00000000-0000-4000-8000-00000007f001', 'st-book',
        '{"partner_name": true, "kids_names": true, "birthday": true}');
insert into public.contacts (id, book_id, full_name, last_save_token) values
  ('20000000-0000-4000-8000-00000007f001', '10000000-0000-4000-8000-00000007f001', 'Ana Reyes',
   '30000000-0000-4000-8000-00000007f001');

create function pg_temp.token() returns uuid language sql as $$
  select last_save_token from public.contacts where id = '20000000-0000-4000-8000-00000007f001'
$$;

select is(pg_temp.token(), '30000000-0000-4000-8000-00000007f001'::uuid, 'an insert keeps its save token');

update public.contacts set city = 'Oslo' where id = '20000000-0000-4000-8000-00000007f001';
select is(pg_temp.token(), null, 'a write that sets no new token clears it');

update public.contacts set city = 'Bergen', last_save_token = '30000000-0000-4000-8000-00000007f002'
where id = '20000000-0000-4000-8000-00000007f001';
select is(pg_temp.token(), '30000000-0000-4000-8000-00000007f002'::uuid, 'a write with a new token keeps it');

update public.contacts set city = 'Tromso', last_save_token = '30000000-0000-4000-8000-00000007f002'
where id = '20000000-0000-4000-8000-00000007f001';
select is(pg_temp.token(), null, 'repeating the same token clears it, so it matches one write only');

select * from finish();
rollback;
