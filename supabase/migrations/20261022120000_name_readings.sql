set lock_timeout = '5s';

-- Owner-only: never add these to get_contact_for_token or any recipient-facing query.
alter table public.contacts
  add column name_reading text
    constraint contacts_name_reading_check check (char_length(name_reading) between 1 and 200),
  add column partner_name_reading text
    constraint contacts_partner_name_reading_check
    check (char_length(partner_name_reading) between 1 and 200);
