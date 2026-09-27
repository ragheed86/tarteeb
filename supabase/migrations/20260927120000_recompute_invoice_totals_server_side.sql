-- 03 — إعادة احتساب إجماليات الفواتير داخل PostgreSQL (المصدر الوحيد للحقيقة).
-- المشكلة: كانت دالّتا create_invoice_with_items وupdate_invoice_with_items تثقان
-- في subtotal وvat_amount وtotal القادمة من المتصفح، فيمكن التلاعب بها أو أن تنحرف
-- عن مجموع البنود. الحل: تُحتسب المبالغ حصراً من invoice_items داخل القاعدة، ويُبقى
-- العميل مسؤولاً فقط عن المدخلات المشروعة (البنود، تفعيل الضريبة، نسبتها).

-- دالة مساعدة تعيد احتساب المجموع الفرعي والضريبة والإجمالي من بنود الفاتورة.
create or replace function public.recompute_invoice_totals(p_invoice_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_subtotal numeric;
  v_vat_applicable boolean;
  v_vat_rate numeric;
  v_vat_amount numeric;
begin
  select coalesce(sum(coalesce(qty, 1) * coalesce(unit_price, 0)), 0)
    into v_subtotal
  from public.invoice_items
  where invoice_id = p_invoice_id;

  select vat_applicable, coalesce(vat_rate, 15.00)
    into v_vat_applicable, v_vat_rate
  from public.invoices
  where id = p_invoice_id;

  v_subtotal := round(v_subtotal, 2);
  v_vat_amount := case
    when coalesce(v_vat_applicable, true) then round(v_subtotal * v_vat_rate / 100.0, 2)
    else 0
  end;

  update public.invoices
  set subtotal = v_subtotal,
      vat_amount = v_vat_amount,
      total = v_subtotal + v_vat_amount
  where id = p_invoice_id;
end;
$$;

revoke execute on function public.recompute_invoice_totals(uuid) from public, anon;
grant execute on function public.recompute_invoice_totals(uuid) to authenticated;

-- إنشاء فاتورة مع بنودها: تُدرَج المبالغ ابتدائياً بصفر ثم تُحتسب من البنود.
create or replace function public.create_invoice_with_items(
  p_invoice jsonb,
  p_items jsonb default '[]'::jsonb
)
returns public.invoices
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_invoice public.invoices%rowtype;
  inserted_items integer := 0;
begin
  insert into public.invoices (
    number,
    project_id,
    client_id,
    issue_at,
    due_at,
    subtotal,
    vat_applicable,
    vat_rate,
    vat_amount,
    total,
    status
  )
  values (
    nullif(p_invoice ->> 'number', ''),
    nullif(p_invoice ->> 'project_id', '')::uuid,
    nullif(p_invoice ->> 'client_id', '')::uuid,
    coalesce(nullif(p_invoice ->> 'issue_at', '')::timestamptz, now()),
    coalesce(nullif(p_invoice ->> 'due_at', '')::date, (coalesce(nullif(p_invoice ->> 'issue_at', '')::timestamptz, now())::date + 14)),
    0, -- subtotal يُحتسب لاحقاً من البنود
    coalesce(nullif(p_invoice ->> 'vat_applicable', '')::boolean, true),
    coalesce(nullif(p_invoice ->> 'vat_rate', '')::numeric, 15.00),
    0, -- vat_amount يُحتسب لاحقاً
    0, -- total يُحتسب لاحقاً
    coalesce(nullif(p_invoice ->> 'status', '')::public.invoice_status, 'unpaid'::public.invoice_status)
  )
  returning * into created_invoice;

  insert into public.invoice_items (invoice_id, description, qty, unit_price)
  select
    created_invoice.id,
    btrim(item.description),
    coalesce(item.qty, 1),
    coalesce(item.unit_price, 0)
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as item(
    description text,
    qty numeric,
    unit_price numeric
  )
  where btrim(coalesce(item.description, '')) <> ''
    and coalesce(item.unit_price, 0) > 0;

  get diagnostics inserted_items = row_count;
  if inserted_items = 0 then
    raise exception 'invoice must include at least one valid item';
  end if;

  perform public.recompute_invoice_totals(created_invoice.id);

  if created_invoice.status <> 'draft'::public.invoice_status then
    perform public.recalculate_invoice_status(created_invoice.id);
  end if;

  select * into created_invoice from public.invoices where id = created_invoice.id;
  return created_invoice;
end;
$$;

revoke execute on function public.create_invoice_with_items(jsonb,jsonb) from public, anon;
grant execute on function public.create_invoice_with_items(jsonb,jsonb) to authenticated;

-- تعديل فاتورة مع استبدال بنودها: لا تُقرأ المبالغ من p_invoice إطلاقاً، بل تُحتسب.
create or replace function public.update_invoice_with_items(
  p_invoice_id uuid,
  p_invoice jsonb,
  p_items jsonb default '[]'::jsonb
)
returns public.invoices
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated_invoice public.invoices%rowtype;
  inserted_items integer := 0;
begin
  update public.invoices
  set
    number = nullif(p_invoice ->> 'number', ''),
    project_id = nullif(p_invoice ->> 'project_id', '')::uuid,
    client_id = nullif(p_invoice ->> 'client_id', '')::uuid,
    issue_at = coalesce(nullif(p_invoice ->> 'issue_at', '')::timestamptz, issue_at),
    due_at = nullif(p_invoice ->> 'due_at', '')::date,
    vat_applicable = coalesce(nullif(p_invoice ->> 'vat_applicable', '')::boolean, vat_applicable),
    vat_rate = coalesce(nullif(p_invoice ->> 'vat_rate', '')::numeric, vat_rate),
    status = coalesce(nullif(p_invoice ->> 'status', '')::public.invoice_status, status)
    -- subtotal وvat_amount وtotal لا تُؤخذ من العميل، تُحتسب أدناه.
  where id = p_invoice_id
  returning * into updated_invoice;

  if not found then
    raise exception 'invoice % was not found', p_invoice_id;
  end if;

  delete from public.invoice_items
  where invoice_id = p_invoice_id;

  insert into public.invoice_items (invoice_id, description, qty, unit_price)
  select
    p_invoice_id,
    btrim(item.description),
    coalesce(item.qty, 1),
    coalesce(item.unit_price, 0)
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as item(
    description text,
    qty numeric,
    unit_price numeric
  )
  where btrim(coalesce(item.description, '')) <> ''
    and coalesce(item.unit_price, 0) > 0;

  get diagnostics inserted_items = row_count;
  if inserted_items = 0 then
    raise exception 'invoice must include at least one valid item';
  end if;

  perform public.recompute_invoice_totals(p_invoice_id);

  if updated_invoice.status <> 'draft'::public.invoice_status then
    perform public.recalculate_invoice_status(p_invoice_id);
  end if;

  select * into updated_invoice
  from public.invoices
  where id = p_invoice_id;

  return updated_invoice;
end;
$$;

revoke execute on function public.update_invoice_with_items(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.update_invoice_with_items(uuid,jsonb,jsonb) to authenticated;
