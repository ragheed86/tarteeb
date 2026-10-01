-- CRM-AUD-06: shared rate-limit counter.
-- The old limiter kept counts in a Map inside one server process, so each
-- Vercel instance / cold start had its own count and keys were never evicted.
-- This counter lives in Postgres: one row per (key, window), incremented
-- atomically, old windows deleted as calls come in. Keys are SHA-256 hashes
-- built by the server (no raw IPs stored). Only service_role can call it.

create table if not exists public.rate_limit_counters (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);
create index if not exists rate_limit_counters_window_idx on public.rate_limit_counters (window_start);

alter table public.rate_limit_counters enable row level security;
revoke all on public.rate_limit_counters from anon, authenticated;

-- Returns the hit count in the current window (including this hit) and the
-- seconds until the window resets. Fixed windows aligned to p_window_seconds.
create or replace function public.rate_limit_hit(p_key text, p_window_seconds int default 60)
returns table (hits int, retry_after int)
language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  if p_key is null or length(p_key) < 16 or p_window_seconds not between 1 and 3600 then
    raise exception 'invalid rate limit key or window';
  end if;
  insert into public.rate_limit_counters as c (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = c.hits + 1
  returning c.hits into v_hits;

  -- TTL: drop windows older than a day (bounded so one call stays cheap)
  delete from public.rate_limit_counters
  where ctid in (select ctid from public.rate_limit_counters where window_start < now() - interval '1 day' limit 100);

  return query select v_hits,
    greatest(1, ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds) - now())))::int);
end;
$$;

revoke execute on function public.rate_limit_hit(text, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int) to service_role;
