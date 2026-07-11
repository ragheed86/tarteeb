-- حالة «مرتجعة» للفاتورة
alter type public.invoice_status add value if not exists 'refunded';
