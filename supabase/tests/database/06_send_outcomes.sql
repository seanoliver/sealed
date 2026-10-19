begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000f0001', 'so@test.dev');
insert into public.books (id, owner_id, slug)
values ('10000000-0000-4000-8000-0000000f0001', '00000000-0000-4000-8000-0000000f0001', 'so-test-book');
insert into public.contacts (id, book_id, full_name)
values ('20000000-0000-4000-8000-0000000f0001', '10000000-0000-4000-8000-0000000f0001', 'Ana Reyes');

select lives_ok($$
  insert into public.email_sends (contact_id, book_id, status, failure_reason) values
    ('20000000-0000-4000-8000-0000000f0001', '10000000-0000-4000-8000-0000000f0001', 'failed', 'rejected'),
    ('20000000-0000-4000-8000-0000000f0001', '10000000-0000-4000-8000-0000000f0001', 'unconfirmed', null)
$$, 'failed and unconfirmed sends are recorded without a Resend id');

select throws_ok($$
  insert into public.email_sends (contact_id, book_id, status, failure_reason)
  values ('20000000-0000-4000-8000-0000000f0001', '10000000-0000-4000-8000-0000000f0001', 'sent', 'quota')
$$, '23514', null, 'only a failed send carries a reason');

select throws_ok($$
  insert into public.email_sends (contact_id, book_id, status, failure_reason)
  values ('20000000-0000-4000-8000-0000000f0001', '10000000-0000-4000-8000-0000000f0001', 'failed', 'bogus')
$$, '23514', null, 'the reason is one of the known kinds');

select throws_ok($$
  insert into public.email_sends (contact_id, book_id, status)
  values ('20000000-0000-4000-8000-0000000f0001', '10000000-0000-4000-8000-0000000f0001', 'lost')
$$, '23514', null, 'unknown statuses are refused');

select * from finish();
rollback;
