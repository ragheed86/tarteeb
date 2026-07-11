-- تحصين إعادة حساب الحالة: الفاتورة المرتجعة تبقى مرتجعة ولا يعيدها تجميع الدفعات
create or replace function public.recalculate_invoice_status(p_invoice_id uuid)
 returns invoice_status
 language plpgsql
 set search_path to ''
as $function$
declare
  invoice_row public.invoices%rowtype;
  paid_total numeric(12,2);
  next_status public.invoice_status;
begin
  select * into invoice_row from public.invoices where id = p_invoice_id;
  if not found then
    return null;
  end if;

  -- المرتجعة حالة نهائية يدوية: لا تُعاد حسابياً
  if invoice_row.status = 'refunded'::public.invoice_status then
    return 'refunded'::public.invoice_status;
  end if;

  select coalesce(sum(amount), 0) into paid_total
  from public.invoice_payments where invoice_id = p_invoice_id;

  if paid_total >= invoice_row.total and invoice_row.total > 0 then
    next_status := 'paid'::public.invoice_status;
  elsif paid_total > 0 then
    next_status := 'partial'::public.invoice_status;
  elsif invoice_row.status = 'draft'::public.invoice_status then
    next_status := 'draft'::public.invoice_status;
  elsif invoice_row.due_at is not null and invoice_row.due_at < current_date then
    next_status := 'overdue'::public.invoice_status;
  else
    next_status := 'unpaid'::public.invoice_status;
  end if;

  update public.invoices
  set status = next_status,
      paid_at = case when next_status = 'paid'::public.invoice_status then coalesce(paid_at, now()) else null end
  where id = p_invoice_id;

  return next_status;
end;
$function$;
