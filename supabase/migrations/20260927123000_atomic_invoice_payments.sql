-- 02 — منع تجاوز دفعات الفواتير تحت التزامن.
-- المشكلة: كان trg_invoice_payments_prevent_overpayment يقرأ مجموع المدفوع
-- السابق دون قفل صف الفاتورة، فطلبان متزامنان يقرآن نفس القيمة قبل أن يُدرج
-- أيّهما، فيتجاوز مجموعهما إجمالي الفاتورة (race condition).
-- الحل: قفل صف الفاتورة FOR UPDATE قبل حساب المتبقي — فتتسلسل الدفعات على
-- نفس الفاتورة مهما كان مسار الإدخال — وإضافة RPC ذرية add_invoice_payment.

-- 1) تحديث الـ trigger ليقفل صف الفاتورة قبل التحقق (دفاع على كل مسارات الإدخال).
create or replace function public.prevent_invoice_overpayment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  invoice_total numeric(12,2);
  existing_paid numeric(12,2);
begin
  if coalesce(new.amount, 0) <= 0 then
    raise exception 'payment amount must be positive';
  end if;

  -- القفل التشاؤمي: يسلسل الدفعات المتزامنة على نفس الفاتورة.
  select total into invoice_total
  from public.invoices
  where id = new.invoice_id
  for update;

  if not found then
    raise exception 'invoice not found';
  end if;

  select coalesce(sum(amount), 0)
  into existing_paid
  from public.invoice_payments
  where invoice_id = new.invoice_id
    and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if existing_paid + new.amount > invoice_total then
    raise exception 'payment exceeds remaining invoice amount (remaining: %)',
      greatest(invoice_total - existing_paid, 0);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_invoice_payments_prevent_overpayment on public.invoice_payments;
create trigger trg_invoice_payments_prevent_overpayment
  before insert or update of amount, invoice_id on public.invoice_payments
  for each row execute function public.prevent_invoice_overpayment();

-- 2) RPC ذرية لإضافة دفعة: تقفل الفاتورة، تتحقق من المتبقي، تُدرج، ثم تعيد
--    احتساب حالة الفاتورة — كلها في معاملة واحدة.
create or replace function public.add_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_paid_at timestamptz default now(),
  p_method text default 'cash',
  p_note text default null
)
returns public.invoice_payments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  invoice_total numeric(12,2);
  existing_paid numeric(12,2);
  new_payment public.invoice_payments%rowtype;
begin
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'payment amount must be positive';
  end if;

  select total into invoice_total
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'invoice % was not found', p_invoice_id;
  end if;

  select coalesce(sum(amount), 0)
  into existing_paid
  from public.invoice_payments
  where invoice_id = p_invoice_id;

  if existing_paid + p_amount > invoice_total then
    raise exception 'payment exceeds remaining invoice amount (remaining: %)',
      greatest(invoice_total - existing_paid, 0);
  end if;

  insert into public.invoice_payments (invoice_id, amount, paid_at, method, note)
  values (
    p_invoice_id,
    p_amount,
    coalesce(p_paid_at, now()),
    coalesce(nullif(btrim(p_method), ''), 'cash'),
    nullif(btrim(p_note), '')
  )
  returning * into new_payment;

  perform public.recalculate_invoice_status(p_invoice_id);

  return new_payment;
end;
$$;

revoke execute on function public.add_invoice_payment(uuid,numeric,timestamptz,text,text) from public, anon;
grant execute on function public.add_invoice_payment(uuid,numeric,timestamptz,text,text) to authenticated;
