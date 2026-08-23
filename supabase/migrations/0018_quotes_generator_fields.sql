-- عرض الأسعار: إنشاء المخطط الكامل ثم مواءمته مع مولّد العروض في التطبيق.
-- هذا الملف متعمّد أن يكون idempotent حتى يصلح مشروعاً قديماً أو قاعدة جديدة.

do $$ begin
  create type public.quote_status as enum ('draft', 'sent', 'accepted', 'rejected', 'expired', 'negotiation');
exception when duplicate_object then null;
end $$;

create table if not exists public.services (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  default_rate  numeric not null default 0,
  vat_rate      numeric,
  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.quotes (
  id                uuid primary key default gen_random_uuid(),
  number            text unique,
  client_id         uuid references public.clients(id) on delete restrict,
  project_id        uuid references public.projects(id) on delete set null,
  invoice_id        uuid references public.invoices(id) on delete set null,
  status            public.quote_status not null default 'draft',
  title             text,
  challenge         text,
  solution          text,
  duration_note     text,
  tools_budget_min  numeric,
  tools_budget_max  numeric,
  terms_note        text,
  subtotal          numeric not null default 0,
  discount_total    numeric not null default 0,
  total             numeric not null default 0,
  issue_date        date not null default current_date,
  validity_days     integer not null default 7,
  sent_at           timestamptz,
  accepted_at       timestamptz,
  rejected_at       timestamptz,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.quote_items (
  id           uuid primary key default gen_random_uuid(),
  quote_id     uuid not null references public.quotes(id) on delete cascade,
  description  text not null,
  unit_price   numeric not null default 0,
  qty          numeric not null default 1,
  discount     numeric not null default 0,
  line_total   numeric generated always as ((unit_price * qty) - discount) stored,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  vat_rate     numeric
);

create or replace function public.quotes_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_quotes_touch on public.quotes;
create trigger trg_quotes_touch
  before update on public.quotes
  for each row execute function public.quotes_touch_updated_at();

create index if not exists idx_quote_items_quote on public.quote_items(quote_id);
create index if not exists idx_quotes_project on public.quotes(project_id);

alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.services enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['quotes', 'quote_items'] loop
    execute format('drop policy if exists permission_select on public.%I', table_name);
    execute format('drop policy if exists permission_insert on public.%I', table_name);
    execute format('drop policy if exists permission_update on public.%I', table_name);
    execute format('drop policy if exists permission_delete on public.%I', table_name);
    execute format('create policy permission_select on public.%I for select to authenticated using ((select public.has_permission(''quotes'')))', table_name);
    execute format('create policy permission_insert on public.%I for insert to authenticated with check ((select public.has_permission(''quotes'')))', table_name);
    execute format('create policy permission_update on public.%I for update to authenticated using ((select public.has_permission(''quotes''))) with check ((select public.has_permission(''quotes'')))', table_name);
    execute format('create policy permission_delete on public.%I for delete to authenticated using ((select public.has_permission(''quotes'')))', table_name);
  end loop;
end $$;

drop policy if exists permission_select on public.services;
create policy permission_select on public.services for select to authenticated
  using ((select public.has_permission('quotes')) or (select public.has_permission('invoices')) or (select public.has_permission('settings')));
drop policy if exists permission_insert on public.services;
create policy permission_insert on public.services for insert to authenticated with check ((select public.has_permission('settings')));
drop policy if exists permission_update on public.services;
create policy permission_update on public.services for update to authenticated
  using ((select public.has_permission('settings'))) with check ((select public.has_permission('settings')));
drop policy if exists permission_delete on public.services;
create policy permission_delete on public.services for delete to authenticated using ((select public.has_permission('settings')));

revoke all on public.quotes, public.quote_items, public.services from anon;
grant select, insert, update, delete on public.quotes, public.quote_items, public.services to authenticated;
grant all on public.quotes, public.quote_items, public.services to service_role;

-- قيمة حالة جديدة: تفاوض
alter type public.quote_status add value if not exists 'negotiation';

-- أعمدة يحتاجها المولّد الحالي
alter table public.quotes
  add column if not exists client_name      text,            -- اسم العميل الحر قبل ربطه بجدول العملاء
  add column if not exists description       text,            -- وصف المشروع (القسم 01)
  add column if not exists validity_note     text,            -- جملة الصلاحية المعروضة
  add column if not exists tools_show        boolean not null default true,
  add column if not exists rejection_reason  text,
  add column if not exists status_history    jsonb  not null default '[]'::jsonb;

create index if not exists idx_quotes_client_id on public.quotes(client_id);
create index if not exists idx_quotes_status    on public.quotes(status);
