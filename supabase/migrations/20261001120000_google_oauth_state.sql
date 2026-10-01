-- CRM-AUD-01: OAuth state for Google Calendar linking.
-- The old flow used the raw employee id as `state`, so anyone could finish an
-- OAuth consent with their own Google account and attach it to any employee.
-- Each link attempt now gets a random, single-use, short-lived state bound to
-- the user who started it and to a cookie in that user's browser, plus a PKCE
-- verifier. Only the server (service role) reads or writes this table.

create table if not exists public.google_oauth_states (
  state_hash text primary key,
  browser_hash text not null,
  employee_id uuid not null references public.employees(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  code_verifier text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists google_oauth_states_expires_idx on public.google_oauth_states(expires_at);

alter table public.google_oauth_states enable row level security;
revoke all on public.google_oauth_states from anon, authenticated;

-- Fix the gap the audit noted: connected_by was never filled.
comment on column public.employee_calendar_connections.connected_by is
  'User who started the OAuth link (from google_oauth_states.user_id).';
