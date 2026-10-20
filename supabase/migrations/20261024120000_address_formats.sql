set lock_timeout = '5s';

alter table public.contacts
  add column country_code text
    constraint contacts_country_code_check check (country_code ~ '^[A-Z]{2}$'),
  add column district text
    constraint contacts_district_check check (char_length(district) <= 120);

alter table public.books
  add column sender_country text not null default 'US'
    constraint books_sender_country_check check (sender_country ~ '^[A-Z]{2}$');

-- Generated with scripts/generate-address-data.ts --sql: every code, English
-- name and alias in src/lib/address, keyed like countryKey() there.
create function private.country_code_for(p_text text)
returns text language sql immutable set search_path = '' as $$
  select v.code
  from (values
    ('ac', 'AC'),
    ('ad', 'AD'),
    ('ae', 'AE'),
    ('af', 'AF'),
    ('afghanistan', 'AF'),
    ('ag', 'AG'),
    ('ai', 'AI'),
    ('al', 'AL'),
    ('aland islands', 'AX'),
    ('albania', 'AL'),
    ('algeria', 'DZ'),
    ('am', 'AM'),
    ('america', 'US'),
    ('american samoa', 'AS'),
    ('andorra', 'AD'),
    ('angola', 'AO'),
    ('anguilla', 'AI'),
    ('antarctica', 'AQ'),
    ('antigua and barbuda', 'AG'),
    ('ao', 'AO'),
    ('aq', 'AQ'),
    ('ar', 'AR'),
    ('argentina', 'AR'),
    ('armenia', 'AM'),
    ('aruba', 'AW'),
    ('as', 'AS'),
    ('ascension island', 'AC'),
    ('at', 'AT'),
    ('au', 'AU'),
    ('australia', 'AU'),
    ('austria', 'AT'),
    ('aw', 'AW'),
    ('ax', 'AX'),
    ('az', 'AZ'),
    ('azerbaijan', 'AZ'),
    ('ba', 'BA'),
    ('bahamas', 'BS'),
    ('bahrain', 'BH'),
    ('bangladesh', 'BD'),
    ('barbados', 'BB'),
    ('bb', 'BB'),
    ('bd', 'BD'),
    ('be', 'BE'),
    ('belarus', 'BY'),
    ('belgium', 'BE'),
    ('belize', 'BZ'),
    ('benin', 'BJ'),
    ('bermuda', 'BM'),
    ('bf', 'BF'),
    ('bg', 'BG'),
    ('bh', 'BH'),
    ('bhutan', 'BT'),
    ('bi', 'BI'),
    ('bj', 'BJ'),
    ('bl', 'BL'),
    ('bm', 'BM'),
    ('bn', 'BN'),
    ('bo', 'BO'),
    ('bolivia', 'BO'),
    ('bosnia and herzegovina', 'BA'),
    ('botswana', 'BW'),
    ('bouvet island', 'BV'),
    ('bq', 'BQ'),
    ('br', 'BR'),
    ('brazil', 'BR'),
    ('britain', 'GB'),
    ('british indian ocean territory', 'IO'),
    ('british virgin islands', 'VG'),
    ('brunei', 'BN'),
    ('bs', 'BS'),
    ('bt', 'BT'),
    ('bulgaria', 'BG'),
    ('burkina faso', 'BF'),
    ('burma', 'MM'),
    ('burundi', 'BI'),
    ('bv', 'BV'),
    ('bw', 'BW'),
    ('by', 'BY'),
    ('bz', 'BZ'),
    ('ca', 'CA'),
    ('cambodia', 'KH'),
    ('cameroon', 'CM'),
    ('canada', 'CA'),
    ('cape verde', 'CV'),
    ('caribbean netherlands', 'BQ'),
    ('cayman islands', 'KY'),
    ('cc', 'CC'),
    ('cd', 'CD'),
    ('central african republic', 'CF'),
    ('cf', 'CF'),
    ('cg', 'CG'),
    ('ch', 'CH'),
    ('chad', 'TD'),
    ('chile', 'CL'),
    ('china', 'CN'),
    ('christmas island', 'CX'),
    ('ci', 'CI'),
    ('ck', 'CK'),
    ('cl', 'CL'),
    ('cm', 'CM'),
    ('cn', 'CN'),
    ('co', 'CO'),
    ('cocos keeling islands', 'CC'),
    ('colombia', 'CO'),
    ('comoros', 'KM'),
    ('cook islands', 'CK'),
    ('costa rica', 'CR'),
    ('cote divoire', 'CI'),
    ('cr', 'CR'),
    ('croatia', 'HR'),
    ('cu', 'CU'),
    ('cuba', 'CU'),
    ('curacao', 'CW'),
    ('cv', 'CV'),
    ('cw', 'CW'),
    ('cx', 'CX'),
    ('cy', 'CY'),
    ('cyprus', 'CY'),
    ('cz', 'CZ'),
    ('czech republic', 'CZ'),
    ('czechia', 'CZ'),
    ('de', 'DE'),
    ('democratic republic of the congo', 'CD'),
    ('denmark', 'DK'),
    ('deutschland', 'DE'),
    ('dj', 'DJ'),
    ('djibouti', 'DJ'),
    ('dk', 'DK'),
    ('dm', 'DM'),
    ('do', 'DO'),
    ('dominica', 'DM'),
    ('dominican republic', 'DO'),
    ('dz', 'DZ'),
    ('east timor', 'TL'),
    ('ec', 'EC'),
    ('ecuador', 'EC'),
    ('ee', 'EE'),
    ('eg', 'EG'),
    ('egypt', 'EG'),
    ('eh', 'EH'),
    ('el salvador', 'SV'),
    ('england', 'GB'),
    ('equatorial guinea', 'GQ'),
    ('er', 'ER'),
    ('eritrea', 'ER'),
    ('es', 'ES'),
    ('espana', 'ES'),
    ('estonia', 'EE'),
    ('eswatini', 'SZ'),
    ('et', 'ET'),
    ('ethiopia', 'ET'),
    ('falkland islands', 'FK'),
    ('faroe islands', 'FO'),
    ('fi', 'FI'),
    ('fiji', 'FJ'),
    ('finland', 'FI'),
    ('fj', 'FJ'),
    ('fk', 'FK'),
    ('fm', 'FM'),
    ('fo', 'FO'),
    ('fr', 'FR'),
    ('france', 'FR'),
    ('french guiana', 'GF'),
    ('french polynesia', 'PF'),
    ('french southern territories', 'TF'),
    ('ga', 'GA'),
    ('gabon', 'GA'),
    ('gambia', 'GM'),
    ('gb', 'GB'),
    ('gd', 'GD'),
    ('ge', 'GE'),
    ('georgia', 'GE'),
    ('germany', 'DE'),
    ('gf', 'GF'),
    ('gg', 'GG'),
    ('gh', 'GH'),
    ('ghana', 'GH'),
    ('gi', 'GI'),
    ('gibraltar', 'GI'),
    ('gl', 'GL'),
    ('gm', 'GM'),
    ('gn', 'GN'),
    ('gp', 'GP'),
    ('gq', 'GQ'),
    ('gr', 'GR'),
    ('great britain', 'GB'),
    ('greece', 'GR'),
    ('greenland', 'GL'),
    ('grenada', 'GD'),
    ('gs', 'GS'),
    ('gt', 'GT'),
    ('gu', 'GU'),
    ('guadeloupe', 'GP'),
    ('guam', 'GU'),
    ('guatemala', 'GT'),
    ('guernsey', 'GG'),
    ('guinea', 'GN'),
    ('guinea bissau', 'GW'),
    ('guyana', 'GY'),
    ('gw', 'GW'),
    ('gy', 'GY'),
    ('haiti', 'HT'),
    ('heard island and mcdonald islands', 'HM'),
    ('hk', 'HK'),
    ('hm', 'HM'),
    ('hn', 'HN'),
    ('holland', 'NL'),
    ('honduras', 'HN'),
    ('hong kong', 'HK'),
    ('hong kong sar', 'HK'),
    ('hong kong sar china', 'HK'),
    ('hr', 'HR'),
    ('ht', 'HT'),
    ('hu', 'HU'),
    ('hungary', 'HU'),
    ('iceland', 'IS'),
    ('id', 'ID'),
    ('ie', 'IE'),
    ('il', 'IL'),
    ('im', 'IM'),
    ('in', 'IN'),
    ('india', 'IN'),
    ('indonesia', 'ID'),
    ('io', 'IO'),
    ('iq', 'IQ'),
    ('ir', 'IR'),
    ('iran', 'IR'),
    ('iraq', 'IQ'),
    ('ireland', 'IE'),
    ('is', 'IS'),
    ('isle of man', 'IM'),
    ('israel', 'IL'),
    ('it', 'IT'),
    ('italy', 'IT'),
    ('ivory coast', 'CI'),
    ('jamaica', 'JM'),
    ('japan', 'JP'),
    ('je', 'JE'),
    ('jersey', 'JE'),
    ('jm', 'JM'),
    ('jo', 'JO'),
    ('jordan', 'JO'),
    ('jp', 'JP'),
    ('kazakhstan', 'KZ'),
    ('ke', 'KE'),
    ('kenya', 'KE'),
    ('kg', 'KG'),
    ('kh', 'KH'),
    ('ki', 'KI'),
    ('kiribati', 'KI'),
    ('km', 'KM'),
    ('kn', 'KN'),
    ('korea', 'KR'),
    ('kosovo', 'XK'),
    ('kp', 'KP'),
    ('kr', 'KR'),
    ('kuwait', 'KW'),
    ('kw', 'KW'),
    ('ky', 'KY'),
    ('kyrgyzstan', 'KG'),
    ('kz', 'KZ'),
    ('la', 'LA'),
    ('laos', 'LA'),
    ('latvia', 'LV'),
    ('lb', 'LB'),
    ('lc', 'LC'),
    ('lebanon', 'LB'),
    ('lesotho', 'LS'),
    ('li', 'LI'),
    ('liberia', 'LR'),
    ('libya', 'LY'),
    ('liechtenstein', 'LI'),
    ('lithuania', 'LT'),
    ('lk', 'LK'),
    ('lr', 'LR'),
    ('ls', 'LS'),
    ('lt', 'LT'),
    ('lu', 'LU'),
    ('luxembourg', 'LU'),
    ('lv', 'LV'),
    ('ly', 'LY'),
    ('ma', 'MA'),
    ('macao', 'MO'),
    ('macao sar china', 'MO'),
    ('macau', 'MO'),
    ('macedonia', 'MK'),
    ('madagascar', 'MG'),
    ('mainland china', 'CN'),
    ('malawi', 'MW'),
    ('malaysia', 'MY'),
    ('maldives', 'MV'),
    ('mali', 'ML'),
    ('malta', 'MT'),
    ('marshall islands', 'MH'),
    ('martinique', 'MQ'),
    ('mauritania', 'MR'),
    ('mauritius', 'MU'),
    ('mayotte', 'YT'),
    ('mc', 'MC'),
    ('md', 'MD'),
    ('me', 'ME'),
    ('mexico', 'MX'),
    ('mf', 'MF'),
    ('mg', 'MG'),
    ('mh', 'MH'),
    ('micronesia', 'FM'),
    ('mk', 'MK'),
    ('ml', 'ML'),
    ('mm', 'MM'),
    ('mn', 'MN'),
    ('mo', 'MO'),
    ('moldova', 'MD'),
    ('monaco', 'MC'),
    ('mongolia', 'MN'),
    ('montenegro', 'ME'),
    ('montserrat', 'MS'),
    ('morocco', 'MA'),
    ('mozambique', 'MZ'),
    ('mp', 'MP'),
    ('mq', 'MQ'),
    ('mr', 'MR'),
    ('ms', 'MS'),
    ('mt', 'MT'),
    ('mu', 'MU'),
    ('mv', 'MV'),
    ('mw', 'MW'),
    ('mx', 'MX'),
    ('my', 'MY'),
    ('myanmar', 'MM'),
    ('mz', 'MZ'),
    ('na', 'NA'),
    ('namibia', 'NA'),
    ('nauru', 'NR'),
    ('nc', 'NC'),
    ('ne', 'NE'),
    ('nederland', 'NL'),
    ('nepal', 'NP'),
    ('netherlands', 'NL'),
    ('new caledonia', 'NC'),
    ('new zealand', 'NZ'),
    ('nf', 'NF'),
    ('ng', 'NG'),
    ('ni', 'NI'),
    ('nicaragua', 'NI'),
    ('niger', 'NE'),
    ('nigeria', 'NG'),
    ('niue', 'NU'),
    ('nl', 'NL'),
    ('no', 'NO'),
    ('norfolk island', 'NF'),
    ('north korea', 'KP'),
    ('north macedonia', 'MK'),
    ('northern ireland', 'GB'),
    ('northern mariana islands', 'MP'),
    ('norway', 'NO'),
    ('np', 'NP'),
    ('nr', 'NR'),
    ('nu', 'NU'),
    ('nz', 'NZ'),
    ('om', 'OM'),
    ('oman', 'OM'),
    ('pa', 'PA'),
    ('pakistan', 'PK'),
    ('palau', 'PW'),
    ('palestine', 'PS'),
    ('palestinian territories', 'PS'),
    ('panama', 'PA'),
    ('papua new guinea', 'PG'),
    ('paraguay', 'PY'),
    ('pe', 'PE'),
    ('peoples republic of china', 'CN'),
    ('peru', 'PE'),
    ('pf', 'PF'),
    ('pg', 'PG'),
    ('ph', 'PH'),
    ('philippines', 'PH'),
    ('pitcairn islands', 'PN'),
    ('pk', 'PK'),
    ('pl', 'PL'),
    ('pm', 'PM'),
    ('pn', 'PN'),
    ('poland', 'PL'),
    ('portugal', 'PT'),
    ('pr', 'PR'),
    ('prc', 'CN'),
    ('ps', 'PS'),
    ('pt', 'PT'),
    ('puerto rico', 'PR'),
    ('pw', 'PW'),
    ('py', 'PY'),
    ('qa', 'QA'),
    ('qatar', 'QA'),
    ('re', 'RE'),
    ('republic of korea', 'KR'),
    ('republic of the congo', 'CG'),
    ('reunion', 'RE'),
    ('ro', 'RO'),
    ('romania', 'RO'),
    ('rs', 'RS'),
    ('ru', 'RU'),
    ('russia', 'RU'),
    ('russian federation', 'RU'),
    ('rw', 'RW'),
    ('rwanda', 'RW'),
    ('sa', 'SA'),
    ('saint barthelemy', 'BL'),
    ('saint helena', 'SH'),
    ('saint kitts and nevis', 'KN'),
    ('saint lucia', 'LC'),
    ('saint martin', 'MF'),
    ('saint pierre and miquelon', 'PM'),
    ('saint vincent and grenadines', 'VC'),
    ('samoa', 'WS'),
    ('san marino', 'SM'),
    ('sao tome and principe', 'ST'),
    ('saudi arabia', 'SA'),
    ('sb', 'SB'),
    ('sc', 'SC'),
    ('scotland', 'GB'),
    ('sd', 'SD'),
    ('se', 'SE'),
    ('senegal', 'SN'),
    ('serbia', 'RS'),
    ('seychelles', 'SC'),
    ('sg', 'SG'),
    ('sh', 'SH'),
    ('si', 'SI'),
    ('sierra leone', 'SL'),
    ('singapore', 'SG'),
    ('sint maarten', 'SX'),
    ('sj', 'SJ'),
    ('sk', 'SK'),
    ('sl', 'SL'),
    ('slovakia', 'SK'),
    ('slovenia', 'SI'),
    ('sm', 'SM'),
    ('sn', 'SN'),
    ('so', 'SO'),
    ('solomon islands', 'SB'),
    ('somalia', 'SO'),
    ('south africa', 'ZA'),
    ('south georgia and the south sandwich islands', 'GS'),
    ('south korea', 'KR'),
    ('south sudan', 'SS'),
    ('spain', 'ES'),
    ('sr', 'SR'),
    ('sri lanka', 'LK'),
    ('ss', 'SS'),
    ('st', 'ST'),
    ('sudan', 'SD'),
    ('suriname', 'SR'),
    ('sv', 'SV'),
    ('svalbard and jan mayen', 'SJ'),
    ('swaziland', 'SZ'),
    ('sweden', 'SE'),
    ('switzerland', 'CH'),
    ('sx', 'SX'),
    ('sy', 'SY'),
    ('syria', 'SY'),
    ('sz', 'SZ'),
    ('ta', 'TA'),
    ('taiwan', 'TW'),
    ('tajikistan', 'TJ'),
    ('tanzania', 'TZ'),
    ('tc', 'TC'),
    ('td', 'TD'),
    ('tf', 'TF'),
    ('tg', 'TG'),
    ('th', 'TH'),
    ('thailand', 'TH'),
    ('timor leste', 'TL'),
    ('tj', 'TJ'),
    ('tk', 'TK'),
    ('tl', 'TL'),
    ('tm', 'TM'),
    ('tn', 'TN'),
    ('to', 'TO'),
    ('togo', 'TG'),
    ('tokelau', 'TK'),
    ('tonga', 'TO'),
    ('tr', 'TR'),
    ('trinidad and tobago', 'TT'),
    ('tristan da cunha', 'TA'),
    ('tt', 'TT'),
    ('tunisia', 'TN'),
    ('turkey', 'TR'),
    ('turkiye', 'TR'),
    ('turkmenistan', 'TM'),
    ('turks and caicos islands', 'TC'),
    ('tuvalu', 'TV'),
    ('tv', 'TV'),
    ('tw', 'TW'),
    ('tz', 'TZ'),
    ('ua', 'UA'),
    ('uae', 'AE'),
    ('ug', 'UG'),
    ('uganda', 'UG'),
    ('uk', 'GB'),
    ('ukraine', 'UA'),
    ('um', 'UM'),
    ('united arab emirates', 'AE'),
    ('united kingdom', 'GB'),
    ('united states', 'US'),
    ('united states minor outlying islands', 'UM'),
    ('united states of america', 'US'),
    ('uruguay', 'UY'),
    ('us', 'US'),
    ('us virgin islands', 'VI'),
    ('usa', 'US'),
    ('uy', 'UY'),
    ('uz', 'UZ'),
    ('uzbekistan', 'UZ'),
    ('va', 'VA'),
    ('vanuatu', 'VU'),
    ('vatican', 'VA'),
    ('vatican city', 'VA'),
    ('vc', 'VC'),
    ('ve', 'VE'),
    ('venezuela', 'VE'),
    ('vg', 'VG'),
    ('vi', 'VI'),
    ('vietnam', 'VN'),
    ('vn', 'VN'),
    ('vu', 'VU'),
    ('wales', 'GB'),
    ('wallis and futuna', 'WF'),
    ('western sahara', 'EH'),
    ('wf', 'WF'),
    ('ws', 'WS'),
    ('xk', 'XK'),
    ('ye', 'YE'),
    ('yemen', 'YE'),
    ('yt', 'YT'),
    ('za', 'ZA'),
    ('zambia', 'ZM'),
    ('zimbabwe', 'ZW'),
    ('zm', 'ZM'),
    ('zw', 'ZW'),
    ('대한민국', 'KR'),
    ('한국', 'KR'),
    ('中华人民共和国', 'CN'),
    ('中国', 'CN'),
    ('中國', 'CN'),
    ('台湾', 'TW'),
    ('台灣', 'TW'),
    ('日本', 'JP'),
    ('香港', 'HK')
  ) v(key, code)
  where v.key = regexp_replace(trim(regexp_replace(regexp_replace(replace(
          regexp_replace(
            translate(lower(p_text), 'áàâäãåçéèêëíìîïñóòôöõøúùûüýÿ', 'aaaaaaceeeeiiiinoooooouuuuyy'),
            '[.''’]', '', 'g'),
          '&', ' and '), '[,()-]', ' ', 'g'), '\s+', ' ', 'g')), '^the ', '')
$$;

revoke all on function private.country_code_for(text) from public, anon, authenticated;

-- Keep the update quiet: it must not move updated_at (the table's Updated
-- column, agent undo checks) or re-derive names.
alter table public.contacts disable trigger contacts_touch;
alter table public.contacts disable trigger contacts_sync_names;
update public.contacts
set country_code = private.country_code_for(country)
where country is not null and country_code is null;
alter table public.contacts enable trigger contacts_touch;
alter table public.contacts enable trigger contacts_sync_names;

-- A write that sets country_code itself is left alone, so a derived code never
-- overwrites a picked one.
create function private.sync_country_code()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.country is not null
     and (tg_op = 'INSERT' and new.country_code is null
          or tg_op = 'UPDATE' and new.country is distinct from old.country
             and new.country_code is not distinct from old.country_code) then
    new.country_code := private.country_code_for(new.country);
  end if;
  return new;
end $$;

revoke all on function private.sync_country_code() from public, anon, authenticated;

create trigger contacts_sync_country_code
  before insert or update of country on public.contacts
  for each row execute function private.sync_country_code();

create or replace function private.get_contact_for_token(p_token text)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'contact', jsonb_build_object(
      'full_name', c.full_name, 'partner_name', c.partner_name,
      'kids_names', c.kids_names,
      'first_name', c.first_name, 'last_name', c.last_name,
      'partner_first_name', c.partner_first_name,
      'partner_last_name', c.partner_last_name, 'kids', c.kids,
      'email', case t.recipient when 'partner' then c.partner_email else c.email end,
      'birthday', c.birthday,
      'address_line1', c.address_line1, 'address_line2', c.address_line2,
      'district', c.district, 'city', c.city, 'state_region', c.state_region,
      'postal_code', c.postal_code, 'country', c.country, 'country_code', c.country_code),
    'enabled_fields', b.enabled_fields,
    'owner_name', p.display_name,
    'sender_country', b.sender_country,
    'recipient', t.recipient,
    'updated_at', c.updated_at)
  from public.update_tokens t
  join public.contacts c on c.id = t.contact_id
  join public.books b on b.id = c.book_id
  join public.profiles p on p.id = b.owner_id
  where t.token_hash = extensions.digest(p_token, 'sha256')
    and t.expires_at > now()
    and t.used_at is null
$$;

create or replace function private.apply_token_reply(
  p_token text, p_payload jsonb, p_seen_at timestamptz default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_contact_id uuid;
  v_book_id uuid;
  v_recipient text;
  v_enabled jsonb;
  v_before jsonb;
  v_after jsonb;
  v_updated_at timestamptz;
  v_conflict boolean;
  v_audited jsonb;
  v_email extensions.citext;
  v_first text;
  v_last text;
  v_partner boolean;
  v_partner_first text;
  v_partner_last text;
  v_kids_given boolean;
  v_kids jsonb;
  v_country_given boolean;
begin
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or pg_column_size(p_payload) > 65536 then
    return null;
  end if;

  select t.contact_id, t.recipient, c.book_id, b.enabled_fields
    into v_contact_id, v_recipient, v_book_id, v_enabled
  from public.update_tokens t
  join public.contacts c on c.id = t.contact_id
  join public.books b on b.id = c.book_id
  where t.token_hash = extensions.digest(p_token, 'sha256')
    and t.expires_at > now()
    and t.used_at is null
  for update of t;

  if v_contact_id is null then return null; end if;

  v_first := nullif(trim(p_payload ->> 'first_name'), '');
  v_last := nullif(trim(p_payload ->> 'last_name'), '');
  if v_first is null or v_last is null then
    v_first := null;
    v_last := null;
  end if;

  v_partner := coalesce((v_enabled ->> 'partner_name')::boolean, false)
    and (p_payload ? 'partner_first_name' or p_payload ? 'partner_last_name');
  v_partner_first := nullif(trim(p_payload ->> 'partner_first_name'), '');
  v_partner_last := case when v_partner_first is not null
                         then nullif(trim(p_payload ->> 'partner_last_name'), '') end;

  v_kids_given := coalesce((v_enabled ->> 'kids_names')::boolean, false)
    and p_payload ? 'kids';
  if v_kids_given and jsonb_typeof(p_payload -> 'kids') = 'array' then
    select jsonb_agg(
             case when nullif(trim(k ->> 'last'), '') is null
                  then jsonb_build_object('first', trim(k ->> 'first'))
                  else jsonb_build_object('first', trim(k ->> 'first'),
                                          'last', trim(k ->> 'last')) end
             order by n)
      into v_kids
    from jsonb_array_elements(p_payload -> 'kids') with ordinality e(k, n);
  elsif v_kids_given and jsonb_typeof(p_payload -> 'kids') <> 'null' then
    return null;
  end if;
  if v_kids is not null and not private.valid_kids(v_kids) then
    return null;
  end if;

  v_country_given := p_payload ? 'country_code';
  if v_country_given and coalesce(nullif(trim(p_payload ->> 'country_code'), ''), 'US') !~ '^[A-Z]{2}$' then
    return null;
  end if;

  -- The row lock makes a concurrent reply from the other person wait here,
  -- then see their change.
  select to_jsonb(c) - 'created_at' - 'updated_at', c.updated_at
    into v_before, v_updated_at
  from public.contacts c where c.id = v_contact_id
  for update;

  -- Any change by the other person since the page loaded, even one the owner
  -- edited over since. Their no-op confirm (before = after) is not a change.
  v_conflict := p_seen_at is not null and v_updated_at > p_seen_at and exists (
    select 1 from public.contact_events e
    where e.contact_id = v_contact_id and e.created_at > p_seen_at
      and e.source = 'token' and e.recipient is distinct from v_recipient
      and e.diff -> 'before' is distinct from e.diff -> 'after');

  -- Dropped, not saved: an email equal to the other person's trips
  -- contacts_partner_email_differs and fails the whole reply.
  v_email := nullif(trim(p_payload ->> 'email'), '')::extensions.citext;
  if lower(v_email::text) = lower(case v_recipient when 'partner' then v_before ->> 'email'
                                                   else v_before ->> 'partner_email' end) then
    v_email := null;
  end if;

  -- On a conflict the update only measures what would change: SL001 rolls it
  -- back, triggers included.
  begin
    -- Write the display strings too: the trigger never clears one when its
    -- partner or kids group is removed.
    update public.contacts c set
      first_name   = coalesce(v_first, c.first_name),
      last_name    = coalesce(v_last, c.last_name),
      full_name    = case when v_first is not null then private.format_person(v_first, v_last)
                          else coalesce(nullif(trim(p_payload ->> 'full_name'), ''), c.full_name) end,
      email         = case when v_recipient = 'primary' then coalesce(v_email, c.email) else c.email end,
      partner_email = case when v_recipient = 'partner' then coalesce(v_email, c.partner_email)
                           else c.partner_email end,
      partner_first_name = case when v_partner then v_partner_first else c.partner_first_name end,
      partner_last_name  = case when v_partner then v_partner_last else c.partner_last_name end,
      partner_name = case when v_partner
                          then private.format_person(v_partner_first, v_partner_last)
                          when (v_enabled ->> 'partner_name')::boolean and p_payload ? 'partner_name'
                          then nullif(trim(p_payload ->> 'partner_name'), '') else c.partner_name end,
      kids         = case when v_kids_given then v_kids else c.kids end,
      kids_names   = case when v_kids_given
                          then private.format_kids(v_kids, coalesce(v_last, c.last_name))
                          when (v_enabled ->> 'kids_names')::boolean and p_payload ? 'kids_names'
                          then nullif(trim(p_payload ->> 'kids_names'), '') else c.kids_names end,
      birthday     = case when (v_enabled ->> 'birthday')::boolean and p_payload ? 'birthday'
                          then nullif(trim(p_payload ->> 'birthday'), '')::date else c.birthday end,
      address_line1 = case when p_payload ? 'address_line1' then nullif(trim(p_payload ->> 'address_line1'), '') else c.address_line1 end,
      address_line2 = case when p_payload ? 'address_line2' then nullif(trim(p_payload ->> 'address_line2'), '') else c.address_line2 end,
      district      = case when p_payload ? 'district' then nullif(trim(p_payload ->> 'district'), '') else c.district end,
      city          = case when p_payload ? 'city' then nullif(trim(p_payload ->> 'city'), '') else c.city end,
      state_region  = case when p_payload ? 'state_region' then nullif(trim(p_payload ->> 'state_region'), '') else c.state_region end,
      postal_code   = case when p_payload ? 'postal_code' then nullif(trim(p_payload ->> 'postal_code'), '') else c.postal_code end,
      country_code  = case when v_country_given then nullif(trim(p_payload ->> 'country_code'), '') else c.country_code end,
      country       = case when nullif(trim(p_payload ->> 'country_code'), '') is not null then null
                           when p_payload ? 'country' then nullif(trim(p_payload ->> 'country'), '')
                           else c.country end
    where c.id = v_contact_id;

    select to_jsonb(c) - 'created_at' - 'updated_at' into v_after
    from public.contacts c where c.id = v_contact_id;
    if v_conflict then
      raise exception using errcode = 'SL001';
    end if;
  exception when sqlstate 'SL001' then
    null;
  end;

  update public.update_tokens
    set used_at = now()
  where token_hash = extensions.digest(p_token, 'sha256');

  v_audited := p_payload - array(
    select k from jsonb_object_keys(p_payload) k
    where k not in ('full_name', 'email', 'partner_name', 'kids_names', 'birthday',
                    'address_line1', 'address_line2', 'district', 'city', 'state_region',
                    'postal_code', 'country', 'country_code', 'first_name', 'last_name',
                    'partner_first_name', 'partner_last_name', 'kids'));

  -- Empty values stay: approving the reply must be able to clear a field.
  if v_conflict and v_after is distinct from v_before then
    insert into public.submissions
      (book_id, payload, matched_contact_id, source, recipient, saved_by)
    select v_book_id,
           coalesce(jsonb_object_agg(
             case when k = 'email' and v_recipient = 'partner' then 'partner_email' else k end, v),
             '{}'::jsonb),
           v_contact_id, 'token', v_recipient,
           case v_recipient when 'primary' then 'partner' else 'primary' end
    from jsonb_each(v_audited) e(k, v);
    return 'queued';
  end if;

  insert into public.contact_events (contact_id, source, recipient, diff)
  values (v_contact_id, 'token', v_recipient,
          jsonb_build_object('before', v_before, 'after', v_after, 'payload', v_audited));

  return 'applied';
end $$;

revoke all on function private.get_contact_for_token(text) from public, anon, authenticated;
revoke all on function private.apply_token_reply(text, jsonb, timestamptz) from public, anon, authenticated;
