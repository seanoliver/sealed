set lock_timeout = '5s';

alter table public.email_sends drop constraint email_sends_status_check;
alter table public.email_sends add constraint email_sends_status_check
  check (status in ('sent', 'delivered', 'opened', 'bounced', 'complained', 'failed', 'unconfirmed'));

alter table public.email_sends add column failure_reason text
  constraint email_sends_failure_reason_check
  check (failure_reason in ('rejected', 'quota', 'error') and status = 'failed' or failure_reason is null);
