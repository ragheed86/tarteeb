-- Include due_at in atomic invoice creation and immediately derive collection status.

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
    coalesce(nullif(p_invoice ->> 'subtotal', '')::numeric, 0),
    coalesce(nullif(p_invoice ->> 'vat_applicable', '')::boolean, true),
    coalesce(nullif(p_invoice ->> 'vat_rate', '')::numeric, 15.00),
    coalesce(nullif(p_invoice ->> 'vat_amount', '')::numeric, 0),
    coalesce(nullif(p_invoice ->> 'total', '')::numeric, 0),
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

  if created_invoice.status <> 'draft'::public.invoice_status then
    perform public.recalculate_invoice_status(created_invoice.id);
    select * into created_invoice from public.invoices where id = created_invoice.id;
  end if;

  return created_invoice;
end;
$$;

revoke execute on function public.create_invoice_with_items(jsonb,jsonb) from public, anon;
grant execute on function public.create_invoice_with_items(jsonb,jsonb) to authenticated;
