-- ============================================================
--  إزالة تكامل دفترة (Daftra) واستبداله بتكامل alostaz.io
--  نفس المبدأ: ترتيب = مصدر الحقيقة (CRM) → alostaz.io تستقبل نسخة
--  من العملاء (partners) والفواتير (invoices) ودفعاتها. اتجاه واحد
--  فقط: من ترتيب إلى alostaz.io، بلا تأثير على بيانات ترتيب عند الفشل.
-- ============================================================

drop table if exists public.daftra_settings;

alter table public.clients
  drop column if exists daftra_client_id,
  drop column if exists daftra_synced_at,
  drop column if exists daftra_sync_error;

alter table public.invoices
  drop column if exists daftra_invoice_id,
  drop column if exists daftra_synced_at,
  drop column if exists daftra_sync_error;

alter table public.invoice_payments
  drop column if exists daftra_payment_id,
  drop column if exists daftra_synced_at,
  drop column if exists daftra_sync_error;

-- إعدادات الربط (صف واحد، مثل company_settings). بلا أي سياسة RLS
-- لـauthenticated عن قصد: token سر ولا يجب أن يصل للمتصفح أبداً —
-- القراءة/الكتابة فقط عبر supabaseAdmin (service role) من مسارات API سيرفر.
create table public.alostaz_settings (
  id                     uuid primary key default gen_random_uuid(),
  base_url               text,     -- API Base URL من لوحة alostaz.io (Settings → API Integration)
  token                  text,     -- Bearer token
  branch_id              text,     -- X-Branch-Id
  api_version            text,     -- X-API-Version
  locale                 text not null default 'ar', -- X-Locale: ar | en
  default_treasury_id    text,     -- لازم لتسجيل الدفعات (partner-payments.treasury_id)
  default_product_id     text,     -- منتج افتراضي عام تُنسب له كل بنود الفواتير
  default_storehouse_id  text,     -- مخزن افتراضي عام تُنسب له كل بنود الفواتير
  enabled                boolean not null default false,
  last_sync_at           timestamptz,
  last_sync_error        text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger trg_alostaz_settings_updated before update on public.alostaz_settings
  for each row execute function public.set_updated_at();

alter table public.alostaz_settings enable row level security;
-- لا سياسات = لا وصول إطلاقاً لـauthenticated/anon؛ service role يتجاوز RLS دائماً.

-- ربط كل عميل بمعرّفه (partner) في alostaz.io بعد أول مزامنة ناجحة
alter table public.clients
  add column if not exists alostaz_partner_id bigint,
  add column if not exists alostaz_synced_at  timestamptz,
  add column if not exists alostaz_sync_error text;

create index if not exists idx_clients_alostaz_partner_id on public.clients(alostaz_partner_id);

-- ربط كل فاتورة بمعرّفها في alostaz.io
alter table public.invoices
  add column if not exists alostaz_invoice_id bigint,
  add column if not exists alostaz_synced_at   timestamptz,
  add column if not exists alostaz_sync_error  text;

create index if not exists idx_invoices_alostaz_invoice_id on public.invoices(alostaz_invoice_id);

-- ربط كل دفعة فاتورة بمعرّف partner-payment الموافق في alostaz.io
alter table public.invoice_payments
  add column if not exists alostaz_payment_id bigint,
  add column if not exists alostaz_synced_at  timestamptz,
  add column if not exists alostaz_sync_error text;

create index if not exists idx_invoice_payments_alostaz_payment_id on public.invoice_payments(alostaz_payment_id);
