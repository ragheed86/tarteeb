-- ============================================================
--  ترتيب · مخطط قاعدة البيانات (المرحلة 1)
--  Tartib ERP — initial schema for Supabase / Postgres
--  Run in: Supabase Studio → SQL Editor
-- ============================================================

-- gen_random_uuid()
create extension if not exists pgcrypto;

-- ---------- updated_at helper ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ============================================================
--  ENUM types
-- ============================================================
create type client_source     as enum ('instagram','tiktok','referral','other');
create type client_status     as enum ('lead','active','completed','waiting');
create type wage_type         as enum ('fixed','daily','hourly');
create type employee_status   as enum ('active','on_project','inactive');
create type doc_type          as enum ('national_id','iqama','contract','health_cert','driving_license','other');
create type project_status    as enum ('quote','preparing','in_progress','delivered','completed','cancelled');
create type cost_kind         as enum ('labor','materials','transport','bonus','other');
create type media_kind        as enum ('before','after','other');
create type invoice_status    as enum ('draft','unpaid','paid','overdue');
create type partner_txn_type  as enum ('profit_share','withdrawal','carryover','deposit');
create type comm_channel      as enum ('whatsapp','telegram','email','phone','system');
create type comm_direction    as enum ('in','out','system');
create type gov_status        as enum ('incomplete','active','expiring','expired');

-- ============================================================
--  SETTINGS · معلومات الشركة (تظهر على الفواتير)
-- ============================================================
create table public.company_settings (
  id                       uuid primary key default gen_random_uuid(),
  name_ar                  text not null,
  name_en                  text,
  cr_number                text,            -- السجل التجاري
  vat_number               text,            -- الرقم الضريبي (ZATCA)
  unified_national_number  text,            -- الرقم الوطني الموحّد
  commercial_code          text,            -- الرمز التجاري
  municipality_license     text,            -- رخصة البلدية
  cr_expiry                date,
  owner_name               text,
  capital                  numeric(14,2),
  phone                    text,
  email                    text,
  city                     text,
  website                  text,
  address                  text,
  updated_at               timestamptz not null default now()
);
create trigger trg_company_updated before update on public.company_settings
  for each row execute function public.set_updated_at();

-- ============================================================
--  CRM · العملاء
-- ============================================================
create table public.clients (
  id               uuid primary key default gen_random_uuid(),
  code             text unique,            -- TRT-014
  name             text not null,
  phone            text,
  source           client_source not null default 'other',
  district         text,                   -- الحي
  status           client_status not null default 'active',
  first_contact_at date,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index idx_clients_source on public.clients(source);
create index idx_clients_status on public.clients(status);
create trigger trg_clients_updated before update on public.clients
  for each row execute function public.set_updated_at();

-- ============================================================
--  EMPLOYEES · الموظفون + مستنداتهم
-- ============================================================
create table public.employees (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  role        text,                         -- مشرف / فني / محاسب ...
  phone       text,
  wage        wage_type default 'fixed',
  status      employee_status not null default 'active',
  photo_url   text,                         -- Supabase Storage path
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_employees_updated before update on public.employees
  for each row execute function public.set_updated_at();

create table public.employee_documents (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id) on delete cascade,
  doc_type     doc_type not null,
  file_url     text,                        -- Storage path
  expiry_date  date,                        -- لتنبيهات الانتهاء
  created_at   timestamptz not null default now()
);
create index idx_empdocs_employee on public.employee_documents(employee_id);
create index idx_empdocs_expiry   on public.employee_documents(expiry_date);

-- ============================================================
--  WAREHOUSE · المستودعات + التصنيفات + الموردون + الأصناف
-- ============================================================
create table public.warehouses (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,                  -- مستودع دلال / رغيد / الرياض
  manager   text,
  location  text
);

create table public.categories (
  id    uuid primary key default gen_random_uuid(),
  name  text not null unique               -- تخزين / منظمات / أدوات
);

create table public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    text default 'أخرى',
  city        text,
  logo_url    text,                         -- Storage path
  created_at  timestamptz not null default now()
);

create table public.inventory_items (
  id             uuid primary key default gen_random_uuid(),
  barcode        text,
  name           text not null,
  category_id    uuid references public.categories(id) on delete set null,
  unit           text default 'قطعة',       -- الوحدة
  quantity       numeric(12,2) not null default 0,
  reorder_level  numeric(12,2) not null default 0,   -- حد التنبيه
  unit_cost      numeric(12,2) not null default 0,
  supplier_id    uuid references public.suppliers(id) on delete set null,
  warehouse_id   uuid references public.warehouses(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_items_warehouse on public.inventory_items(warehouse_id);
create index idx_items_category  on public.inventory_items(category_id);
create index idx_items_barcode   on public.inventory_items(barcode);
create trigger trg_items_updated before update on public.inventory_items
  for each row execute function public.set_updated_at();

-- ============================================================
--  PROJECTS · المشاريع + الفريق + المهام + التكاليف + الوسائط
-- ============================================================
create table public.projects (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  title          text not null,            -- تنظيم دواليب
  service_type   text,                     -- دواليب / مطبخ / نقل ...
  sale_price     numeric(12,2) not null default 0,
  status         project_status not null default 'quote',
  supervisor_id  uuid references public.employees(id) on delete set null,
  start_date     date,
  due_date       date,                     -- موعد التسليم (للعدّادات والتقويم)
  progress       int not null default 0 check (progress between 0 and 100),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_projects_client on public.projects(client_id);
create index idx_projects_status on public.projects(status);
create index idx_projects_due    on public.projects(due_date);
create trigger trg_projects_updated before update on public.projects
  for each row execute function public.set_updated_at();

create table public.project_team (
  project_id   uuid not null references public.projects(id)  on delete cascade,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  primary key (project_id, employee_id)
);

create table public.project_tasks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  title       text not null,
  done        boolean not null default false,
  sort_order  int default 0
);
create index idx_tasks_project on public.project_tasks(project_id);

create table public.project_costs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  kind        cost_kind not null,
  label       text,
  amount      numeric(12,2) not null default 0,
  created_at  timestamptz not null default now()
);
create index idx_costs_project on public.project_costs(project_id);

create table public.project_media (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  kind        media_kind not null,         -- قبل / بعد
  file_url    text not null,               -- Storage path
  created_at  timestamptz not null default now()
);
create index idx_media_project on public.project_media(project_id);

-- صافي الربح والهامش يُحتسبان من sale_price و sum(project_costs) — لا يُخزَّنان
create or replace view public.project_financials as
select p.id as project_id,
       p.sale_price,
       coalesce(sum(c.amount),0)                          as total_cost,
       p.sale_price - coalesce(sum(c.amount),0)           as net_profit,
       case when p.sale_price > 0
            then round((p.sale_price - coalesce(sum(c.amount),0)) / p.sale_price * 100)
            else 0 end                                    as margin_pct
from public.projects p
left join public.project_costs c on c.project_id = p.id
group by p.id, p.sale_price;

-- ============================================================
--  FINANCE · الفواتير (ZATCA) + البنود
-- ============================================================
create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  number         text unique,              -- #1058
  project_id     uuid references public.projects(id) on delete set null,
  client_id      uuid references public.clients(id)  on delete set null,
  issue_at       timestamptz not null default now(),
  subtotal       numeric(12,2) not null default 0,
  vat_applicable boolean not null default true,
  vat_rate       numeric(5,2) not null default 15.00,
  vat_amount     numeric(12,2) not null default 0,
  total          numeric(12,2) not null default 0,
  zatca_uuid     uuid default gen_random_uuid(),   -- ZATCA invoice UUID
  zatca_qr       text,                     -- Base64 TLV QR (يُولّد بالخادم)
  status         invoice_status not null default 'unpaid',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_invoices_client on public.invoices(client_id);
create index idx_invoices_status on public.invoices(status);
create trigger trg_invoices_updated before update on public.invoices
  for each row execute function public.set_updated_at();

create table public.invoice_items (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices(id) on delete cascade,
  description  text not null,
  qty          numeric(12,2) not null default 1,
  unit_price   numeric(12,2) not null default 0
);
create index idx_invitems_invoice on public.invoice_items(invoice_id);

-- ============================================================
--  PARTNERS · حسابات الشركاء
-- ============================================================
create table public.partners (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  share_percent  numeric(5,2) not null default 0,
  created_at     timestamptz not null default now()
);

create table public.partner_transactions (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.partners(id) on delete cascade,
  period      date not null,               -- أول الشهر (2026-06-01)
  txn_type    partner_txn_type not null,
  amount      numeric(12,2) not null,
  note        text,
  created_at  timestamptz not null default now()
);
create index idx_ptxn_partner on public.partner_transactions(partner_id);
create index idx_ptxn_period  on public.partner_transactions(period);

-- ============================================================
--  COMMUNICATIONS · الوارد الموحّد / 360°
-- ============================================================
create table public.communications (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references public.clients(id) on delete cascade,
  channel      comm_channel not null,
  direction    comm_direction not null default 'in',
  body         text,
  occurred_at  timestamptz not null default now()
);
create index idx_comm_client on public.communications(client_id);
create index idx_comm_time   on public.communications(occurred_at);

-- ============================================================
--  GOVERNMENT · الجهات الحكومية والرخص
--  ملاحظة أمنية: لا تُخزَّن كلمات المرور هنا كنص صريح.
--  استخدم Supabase Vault أو تشفيرًا، وقيّد الوصول بدور المالك فقط.
-- ============================================================
create table public.government_accounts (
  id           uuid primary key default gen_random_uuid(),
  entity_name  text not null,              -- بلدي / قوى / هيئة الزكاة ...
  login_url    text,
  username     text,
  secret_ref   text,                       -- مرجع للسر في Vault (وليس كلمة المرور)
  contact      text,
  expiry_date  date,                       -- تنبيه قبل 30 يومًا
  status       gov_status not null default 'incomplete',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_gov_expiry on public.government_accounts(expiry_date);
create trigger trg_gov_updated before update on public.government_accounts
  for each row execute function public.set_updated_at();

-- ============================================================
--  RLS · تفعيل أمان مستوى الصف على كل الجداول
--  سياسة بداية: أي مستخدم موثّق له وصول كامل (شركة واحدة).
--  شدّدها لاحقًا حسب أدوار الموظفين.
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'company_settings','clients','employees','employee_documents','warehouses',
    'categories','suppliers','inventory_items','projects','project_team',
    'project_tasks','project_costs','project_media','invoices','invoice_items',
    'partners','partner_transactions','communications','government_accounts'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($p$
      create policy "authenticated_all" on public.%I
      for all to authenticated using (true) with check (true);
    $p$, t);
  end loop;
end $$;

-- ============================================================
--  SEED · بيانات أساسية للبدء
-- ============================================================
insert into public.company_settings
  (name_ar, name_en, vat_number, city)
values
  ('ترتيب لتنظيم المساحات','Tartib Space Organizing','300123456700003','الرياض');

insert into public.warehouses (name) values
  ('مستودع دلال'), ('مستودع رغيد'), ('مستودع الرياض');

insert into public.categories (name) values
  ('تخزين'), ('منظمات'), ('أدوات');

insert into public.partners (name, share_percent) values
  ('راغد', 50), ('سلطان', 30), ('نواف', 20);

-- تم. شغّل الملف كاملًا في Supabase SQL Editor.
