-- ============================================================
--  تكامل دفترة (Daftra) — المرحلة 1: مزامنة العملاء فقط
--  ترتيب = مصدر الحقيقة (CRM) → دفترة تستقبل نسخة من بيانات العميل
--  للمحاسبة فقط. اتجاه واحد: من ترتيب إلى دفترة.
-- ============================================================

-- إعدادات الربط (صف واحد، مثل company_settings). بلا أي سياسة RLS
-- لـauthenticated عن قصد: api_key سر ولا يجب أن يصل للمتصفح أبداً —
-- القراءة/الكتابة فقط عبر supabaseAdmin (service role) من مسارات API سيرفر.
create table public.daftra_settings (
  id                     uuid primary key default gen_random_uuid(),
  subdomain              text,
  api_key                text,
  enabled                boolean not null default false,
  default_country_code   text not null default 'SA',
  default_currency_code  text not null default 'SAR',
  last_sync_at           timestamptz,
  last_sync_error        text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger trg_daftra_settings_updated before update on public.daftra_settings
  for each row execute function public.set_updated_at();

alter table public.daftra_settings enable row level security;
-- لا سياسات = لا وصول إطلاقاً لـauthenticated/anon؛ service role يتجاوز RLS دائماً.

-- ربط كل عميل بمعرّفه في دفترة بعد أول مزامنة ناجحة
alter table public.clients
  add column if not exists daftra_client_id  bigint,
  add column if not exists daftra_synced_at  timestamptz,
  add column if not exists daftra_sync_error text;

create index if not exists idx_clients_daftra_client_id on public.clients(daftra_client_id);
