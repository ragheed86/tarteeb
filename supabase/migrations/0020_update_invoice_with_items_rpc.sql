-- Atomic invoice edit: update the invoice header and replace its items in one transaction.
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
