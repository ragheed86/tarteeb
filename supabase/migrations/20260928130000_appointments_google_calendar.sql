-- مواعيد/اجتماعات مستقلة عن المشاريع، بحضور متعدد من الموظفين،
-- مع مزامنة أحادية الاتجاه (ترتيب → Google Calendar) لكل موظف متصل بحسابه.
-- ملاحظة: هذا الملف يوثّق مخططاً مُطبَّقاً مسبقاً على قاعدة الإنتاج عبر Supabase MCP.

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) > 0),
  description text,
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_valid_range check (ends_at >= starts_at)
);

create table if not exists public.appointment_attendees (
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  primary key (appointment_id, employee_id)
);

-- اتصال تقويم Google لكل موظف — يحوي توكنات حساسة، تُقرأ وتُكتب فقط من السيرفر (service role).
create table if not exists public.employee_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null unique references public.employees(id) on delete cascade,
  google_email text,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  calendar_id text not null default 'primary',
  connected_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- تتبّع أي حدث Google يقابل أي (موعد، موظف) — لتحديث/حذف نفس الحدث بدل تكراره.
create table if not exists public.appointment_calendar_events (
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  google_event_id text not null,
  synced_at timestamptz not null default now(),
  primary key (appointment_id, employee_id)
);

create index if not exists appointments_starts_at_idx on public.appointments(starts_at);
create index if not exists appointment_attendees_employee_idx on public.appointment_attendees(employee_id);

drop trigger if exists appointments_set_updated_at on public.appointments;
create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();
drop trigger if exists employee_calendar_connections_set_updated_at on public.employee_calendar_connections;
create trigger employee_calendar_connections_set_updated_at
  before update on public.employee_calendar_connections
  for each row execute function public.set_updated_at();

alter table public.appointments enable row level security;
alter table public.appointment_attendees enable row level security;
alter table public.employee_calendar_connections enable row level security;
alter table public.appointment_calendar_events enable row level security;

drop policy if exists permission_select on public.appointments;
drop policy if exists permission_insert on public.appointments;
drop policy if exists permission_update on public.appointments;
drop policy if exists permission_delete on public.appointments;
create policy permission_select on public.appointments for select to authenticated
  using ((select public.has_permission('appointments')));
create policy permission_insert on public.appointments for insert to authenticated
  with check ((select public.has_permission('appointments')));
create policy permission_update on public.appointments for update to authenticated
  using ((select public.has_permission('appointments')))
  with check ((select public.has_permission('appointments')));
create policy permission_delete on public.appointments for delete to authenticated
  using ((select public.has_permission('appointments')));

drop policy if exists permission_select on public.appointment_attendees;
drop policy if exists permission_insert on public.appointment_attendees;
drop policy if exists permission_update on public.appointment_attendees;
drop policy if exists permission_delete on public.appointment_attendees;
create policy permission_select on public.appointment_attendees for select to authenticated
  using ((select public.has_permission('appointments')));
create policy permission_insert on public.appointment_attendees for insert to authenticated
  with check ((select public.has_permission('appointments')));
create policy permission_update on public.appointment_attendees for update to authenticated
  using ((select public.has_permission('appointments')))
  with check ((select public.has_permission('appointments')));
create policy permission_delete on public.appointment_attendees for delete to authenticated
  using ((select public.has_permission('appointments')));

-- لا سياسات لـ authenticated على جدولي الاتصال والمزامنة عمداً: تحوي توكنات Google،
-- والوصول الوحيد المسموح لها هو service role من مسارات API الخادم.

grant select, insert, update, delete on public.appointments to authenticated;
grant select, insert, update, delete on public.appointment_attendees to authenticated;
