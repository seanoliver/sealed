set lock_timeout = '5s';

-- Owner-only pronunciation overrides. get_contact_for_token lists its fields
-- explicitly; never add these to it or to any recipient-facing query.
alter table public.contacts
  add column name_reading text
    constraint contacts_name_reading_check check (char_length(name_reading) between 1 and 200),
  add column partner_name_reading text
    constraint contacts_partner_name_reading_check
    check (char_length(partner_name_reading) between 1 and 200);
