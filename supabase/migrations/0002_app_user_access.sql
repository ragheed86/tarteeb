-- App-level user permissions for Tarteeb.
-- Primary admin: r.kallajo@gmail.com

create table if not exists public.app_user_access (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  email        text not null unique,
  display_name text,
  role         text not null default 'viewer'
    check (role in ('admin','manager','accountant','operations','viewer')),
  permissions  text[] not null default '{}',
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_app_user_access_updated'
  ) then
    create trigger trg_app_user_access_updated
      before update on public.app_user_access
      for each row execute function public.set_updated_at();
  end if;
end $$;

create or replace function public.is_primary_admin()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'r.kallajo@gmail.com';
$$;

alter table public.app_user_access enable row level security;

drop policy if exists "users_can_read_own_access" on public.app_user_access;
create policy "users_can_read_own_access"
  on public.app_user_access
  for select to authenticated
  using (auth.uid() = user_id or public.is_primary_admin());

drop policy if exists "primary_admin_can_manage_access" on public.app_user_access;
create policy "primary_admin_can_manage_access"
  on public.app_user_access
  for all to authenticated
  using (public.is_primary_admin())
  with check (public.is_primary_admin());

insert into public.app_user_access (user_id, email, display_name, role, permissions, active)
select
  id,
  lower(email),
  coalesce(raw_user_meta_data ->> 'display_name', 'رغيد'),
  'admin',
  array[
    'dashboard','settings','clients','projects','cost','warehouse',
    'employees','heatmap','invoices','partners','government'
  ],
  true
from auth.users
where lower(email) = 'r.kallajo@gmail.com'
on conflict (user_id) do update
set
  role = 'admin',
  permissions = excluded.permissions,
  active = true,
  updated_at = now();
