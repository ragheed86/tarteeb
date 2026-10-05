-- update_invoice_with_items كان يمسح number و due_at إلى NULL عند تحديث الفاتورة
-- بدون تمريرهما (بخلاف باقي الحقول التي تستخدم coalesce للحفاظ على القيمة القديمة).
create or replace function public.update_invoice_with_items(p_invoice_id uuid, p_invoice jsonb, p_items jsonb default '[]'::jsonb)
 returns invoices
 language plpgsql
 set search_path to ''
as $function$
declare
  updated_invoice public.invoices%rowtype;
  inserted_items integer := 0;
begin
  update public.invoices
  set
    number = coalesce(nullif(p_invoice ->> 'number', ''), number),
    project_id = coalesce(nullif(p_invoice ->> 'project_id', '')::uuid, project_id),
    client_id = coalesce(nullif(p_invoice ->> 'client_id', '')::uuid, client_id),
    issue_at = coalesce(nullif(p_invoice ->> 'issue_at', '')::timestamptz, issue_at),
    due_at = coalesce(nullif(p_invoice ->> 'due_at', '')::date, due_at),
    subtotal = coalesce(nullif(p_invoice ->> 'subtotal', '')::numeric, subtotal),
    vat_applicable = coalesce(nullif(p_invoice ->> 'vat_applicable', '')::boolean, vat_applicable),
    vat_rate = coalesce(nullif(p_invoice ->> 'vat_rate', '')::numeric, vat_rate),
    vat_amount = coalesce(nullif(p_invoice ->> 'vat_amount', '')::numeric, vat_amount),
    total = coalesce(nullif(p_invoice ->> 'total', '')::numeric, total),
    status = coalesce(nullif(p_invoice ->> 'status', '')::public.invoice_status, status)
  where id = p_invoice_id
  returning * into updated_invoice;

  if not found then
    raise exception 'invoice % was not found', p_invoice_id;
  end if;

  delete from public.invoice_items
  where invoice_id = p_invoice_id;

  insert into public.invoice_items (invoice_id, description, qty, unit, unit_price)
  select
    p_invoice_id,
    btrim(item.description),
    coalesce(item.qty, 1),
    coalesce(nullif(btrim(item.unit), ''), 'غرفة'),
    coalesce(item.unit_price, 0)
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as item(
    description text,
    qty numeric,
    unit text,
    unit_price numeric
  )
  where btrim(coalesce(item.description, '')) <> ''
    and coalesce(item.unit_price, 0) > 0;

  get diagnostics inserted_items = row_count;
  if inserted_items = 0 then
    raise exception 'invoice must include at least one valid item';
  end if;

  if updated_invoice.status <> 'draft'::public.invoice_status then
    perform public.recalculate_invoice_status(p_invoice_id);
  end if;

  select * into updated_invoice
  from public.invoices
  where id = p_invoice_id;

  return updated_invoice;
end;
$function$;
