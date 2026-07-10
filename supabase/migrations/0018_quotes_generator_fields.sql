-- عرض الأسعار: مواءمة جدول quotes الموجود مع مولّد العروض في التطبيق
-- (الجدولان quotes/quote_items موجودان مسبقاً مع RLS مبني على has_permission('quotes'))

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
