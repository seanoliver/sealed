set lock_timeout = '5s';

-- Only Google's names are trusted: a direct signUp for an approved address
-- could otherwise choose the display name that address's recipients will see.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    case
      when new.raw_app_meta_data ->> 'provider' = 'google' then left(coalesce(
        new.raw_user_meta_data ->> 'full_name',
        new.raw_user_meta_data ->> 'name',
        ''
      ), 200)
      else ''
    end
  );
  return new;
end $$;

create index rate_limits_window_start_idx on private.rate_limits (window_start);

-- Each call clears rows older than two days. A caller window of two days or
-- more would lose counts that still apply.
create or replace function private.check_rate_limit(p_key text, p_max int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  delete from private.rate_limits where window_start < now() - interval '2 days';
  insert into private.rate_limits as r (key, count, window_start)
  values (p_key, 1, now())
  on conflict (key) do update set
    -- least(): blocked calls needn't keep counting; also rules out int overflow
    count = case when r.window_start < now() - make_interval(secs => p_window_seconds)
                 then 1 else least(r.count + 1, p_max + 1) end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds)
                        then now() else r.window_start end
  returning r.count <= p_max into v_ok;
  return v_ok;
end $$;
