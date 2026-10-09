-- ============================================================
--  إزالة تكامل alostaz.io — الربط مع alostaz.io أُلغي خارجياً،
--  تزيل هذه الميجريشن كل ما يخصه من قاعدة بيانات ترتيب.
-- ============================================================

drop table if exists public.alostaz_settings;

alter table public.clients
  drop column if exists alostaz_partner_id,
  drop column if exists alostaz_synced_at,
  drop column if exists alostaz_sync_error;

alter table public.invoices
  drop column if exists alostaz_invoice_id,
  drop column if exists alostaz_synced_at,
  drop column if exists alostaz_sync_error;

alter table public.invoice_payments
  drop column if exists alostaz_payment_id,
  drop column if exists alostaz_synced_at,
  drop column if exists alostaz_sync_error;
