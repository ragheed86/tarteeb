-- CRM-AUD-05: Google Calendar tokens move out of plain table columns into
-- Supabase Vault (encrypted at rest), and disconnect revokes the grant at
-- Google with a safe pending state.
--
-- * One vault secret per connection holds {"refresh_token","access_token"}.
--   The table keeps only the secret id; plain token columns are emptied.
-- * Only service_role (the server) can call the gcal_* functions. Vault does
--   not protect against someone who already has full database access; it
--   keeps tokens out of table reads, exports, backups of the table, and logs.
-- * revoke_status = 'pending' means a disconnect was requested: sync stops
--   immediately, and the server keeps retrying the Google revoke until it
--   succeeds, so the token is never dropped before Google invalidates it.

alter table public.employee_calendar_connections
  add column if not exists token_secret_id uuid,
  add column if not exists revoke_status text check (revoke_status is null or revoke_status = 'pending'),
  add column if not exists revoke_requested_at timestamptz;

alter table public.employee_calendar_connections alter column refresh_token drop not null;

-- Defence in depth: RLS already has no policies for these roles.
revoke all on public.employee_calendar_connections from anon, authenticated;

create or replace function public.gcal_store_tokens(
  p_employee uuid, p_refresh text, p_access text, p_expires timestamptz,
  p_email text, p_connected_by uuid
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_secret uuid;
  v_payload text := jsonb_build_object('refresh_token', p_refresh, 'access_token', p_access)::text;
begin
  select token_secret_id into v_secret from public.employee_calendar_connections where employee_id = p_employee for update;
  if v_secret is null then
    v_secret := vault.create_secret(v_payload, 'gcal:' || p_employee::text || ':' || gen_random_uuid()::text, 'Google Calendar tokens');
  else
    perform vault.update_secret(v_secret, v_payload);
  end if;
  insert into public.employee_calendar_connections
    (employee_id, google_email, refresh_token, access_token, access_token_expires_at, connected_by, token_secret_id, revoke_status, revoke_requested_at)
  values (p_employee, p_email, null, null, p_expires, p_connected_by, v_secret, null, null)
  on conflict (employee_id) do update set
    google_email = excluded.google_email, refresh_token = null, access_token = null,
    access_token_expires_at = excluded.access_token_expires_at, connected_by = excluded.connected_by,
    token_secret_id = excluded.token_secret_id, revoke_status = null, revoke_requested_at = null;
end;
$$;

create or replace function public.gcal_get_tokens(p_employee uuid)
returns table (refresh_token text, access_token text, access_token_expires_at timestamptz, calendar_id text, revoke_status text)
language sql stable security definer set search_path = ''
as $$
  select (s.decrypted_secret::jsonb)->>'refresh_token',
         (s.decrypted_secret::jsonb)->>'access_token',
         c.access_token_expires_at, c.calendar_id, c.revoke_status
  from public.employee_calendar_connections c
  join vault.decrypted_secrets s on s.id = c.token_secret_id
  where c.employee_id = p_employee;
$$;

create or replace function public.gcal_update_access(p_employee uuid, p_access text, p_expires timestamptz)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_secret uuid; v_refresh text;
begin
  select c.token_secret_id, (s.decrypted_secret::jsonb)->>'refresh_token' into v_secret, v_refresh
  from public.employee_calendar_connections c join vault.decrypted_secrets s on s.id = c.token_secret_id
  where c.employee_id = p_employee and c.revoke_status is null
  for update of c;
  if v_secret is null then return; end if;
  perform vault.update_secret(v_secret, jsonb_build_object('refresh_token', v_refresh, 'access_token', p_access)::text);
  update public.employee_calendar_connections set access_token_expires_at = p_expires where employee_id = p_employee;
end;
$$;

create or replace function public.gcal_mark_revoking(p_employee uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.employee_calendar_connections
  set revoke_status = 'pending', revoke_requested_at = coalesce(revoke_requested_at, now())
  where employee_id = p_employee;
$$;

-- Removes the connection and its vault secret (after Google revoked the grant).
create or replace function public.gcal_delete(p_employee uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_secret uuid;
begin
  delete from public.employee_calendar_connections where employee_id = p_employee returning token_secret_id into v_secret;
  if v_secret is not null then delete from vault.secrets where id = v_secret; end if;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.gcal_store_tokens(uuid, text, text, timestamptz, text, uuid)',
    'public.gcal_get_tokens(uuid)',
    'public.gcal_update_access(uuid, text, timestamptz)',
    'public.gcal_mark_revoking(uuid)',
    'public.gcal_delete(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Move existing plain tokens into the vault, then clear the columns.
do $$
declare r record;
begin
  for r in select * from public.employee_calendar_connections where token_secret_id is null and refresh_token is not null loop
    perform public.gcal_store_tokens(r.employee_id, r.refresh_token, r.access_token, r.access_token_expires_at, r.google_email, r.connected_by);
  end loop;
end $$;
