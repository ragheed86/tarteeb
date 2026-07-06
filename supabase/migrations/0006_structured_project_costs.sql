-- Replace encoded project-cost labels with structured columns.

alter table public.project_costs add column if not exists work_date date;
alter table public.project_costs add column if not exists note text;
alter table public.project_costs add column if not exists worker_name text;
alter table public.project_costs add column if not exists product_name text;
alter table public.project_costs add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;
alter table public.project_costs add column if not exists supplier_name text;
alter table public.project_costs add column if not exists sale_price numeric(12,2);
alter table public.project_costs add column if not exists markup_percent numeric(7,2);

create index if not exists idx_costs_project_work_date on public.project_costs(project_id, work_date);
create index if not exists idx_costs_supplier on public.project_costs(supplier_id);

update public.project_costs
set work_date = nullif(substring(label from '^يومي:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})'), '')::date
where work_date is null
  and label ~ '^يومي:\s*[0-9]{4}-[0-9]{2}-[0-9]{2}';

update public.project_costs
set worker_name = nullif(btrim(substring(label from 'الموظف:\s*([^·]+)')), '')
where worker_name is null
  and kind = 'labor'
  and label like '%الموظف:%';

update public.project_costs
set product_name = nullif(btrim(substring(label from '(?:^|· )منتج:\s*([^·]+)')), '')
where product_name is null
  and kind = 'materials'
  and label like '%منتج:%';

update public.project_costs
set supplier_name = nullif(btrim(substring(label from 'المورد:\s*([^·]+)')), '')
where supplier_name is null
  and kind = 'materials'
  and label like '%المورد:%';

update public.project_costs
set sale_price = nullif(substring(label from 'البيع:\s*([0-9]+(?:\.[0-9]+)?)'), '')::numeric
where sale_price is null
  and kind = 'materials'
  and label ~ 'البيع:\s*[0-9]';

update public.project_costs
set markup_percent = nullif(substring(label from 'النسبة:\s*([0-9]+(?:\.[0-9]+)?)%?'), '')::numeric
where markup_percent is null
  and kind = 'materials'
  and label ~ 'النسبة:\s*[0-9]';

update public.project_costs
set note = nullif(btrim(substring(label from '(?:^|· )نقل:\s*([^·]+)')), '')
where note is null
  and kind = 'transport'
  and label like '%نقل:%';

update public.project_costs
set note = nullif(btrim(substring(label from '(?:^|· )أخرى:\s*([^·]+)')), '')
where note is null
  and kind = 'other'
  and label like '%أخرى:%';

update public.project_costs
set note = nullif(btrim(regexp_replace(label, '^عمالة:\s*', '')), '')
where note is null
  and kind = 'labor'
  and label like 'عمالة:%'
  and work_date is null;

create or replace function public.replace_project_costs(
  p_project_id uuid,
  p_rows jsonb,
  p_scope text default 'estimate'
)
returns setof public.project_costs
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_scope not in ('estimate', 'daily') then
    raise exception 'invalid project cost replacement scope: %', p_scope;
  end if;

  delete from public.project_costs c
  where c.project_id = p_project_id
    and (
      (
        p_scope = 'daily'
        and (
          c.work_date is not null
          or coalesce(c.label, '') like 'يومي:%'
          or (
            (c.kind = 'labor'::public.cost_kind and (c.label in ('عمالة', 'إشراف') or coalesce(c.label, '') like 'عمالة:%'))
            or (c.kind = 'materials'::public.cost_kind and (c.label is null or coalesce(c.label, '') like 'منتج:%' or c.product_name is not null))
            or (c.kind in ('transport'::public.cost_kind, 'other'::public.cost_kind) and c.label is null)
          )
        )
      )
      or (
        p_scope = 'estimate'
        and c.work_date is null
        and coalesce(c.label, '') not like 'يومي:%'
        and (
          (c.kind = 'labor'::public.cost_kind and (c.label in ('عمالة', 'إشراف') or coalesce(c.label, '') like 'عمالة:%' or c.note is not null))
          or (c.kind = 'materials'::public.cost_kind and (c.label is null or coalesce(c.label, '') like 'منتج:%' or c.product_name is not null))
          or (c.kind in ('transport'::public.cost_kind, 'other'::public.cost_kind) and c.label is null)
        )
      )
    );

  if coalesce(jsonb_array_length(coalesce(p_rows, '[]'::jsonb)), 0) = 0 then
    return;
  end if;

  return query
  insert into public.project_costs (
    project_id,
    kind,
    label,
    amount,
    qty,
    hours,
    rate,
    work_date,
    note,
    worker_name,
    product_name,
    supplier_id,
    supplier_name,
    sale_price,
    markup_percent
  )
  select
    p_project_id,
    row_data.kind::public.cost_kind,
    nullif(row_data.label, ''),
    coalesce(row_data.amount, 0),
    row_data.qty,
    row_data.hours,
    row_data.rate,
    row_data.work_date,
    nullif(row_data.note, ''),
    nullif(row_data.worker_name, ''),
    nullif(row_data.product_name, ''),
    row_data.supplier_id,
    nullif(row_data.supplier_name, ''),
    row_data.sale_price,
    row_data.markup_percent
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as row_data(
    kind text,
    label text,
    amount numeric,
    qty numeric,
    hours numeric,
    rate numeric,
    work_date date,
    note text,
    worker_name text,
    product_name text,
    supplier_id uuid,
    supplier_name text,
    sale_price numeric,
    markup_percent numeric
  )
  where row_data.kind in ('labor', 'materials', 'transport', 'bonus', 'other')
    and coalesce(row_data.amount, 0) > 0
  returning *;
end;
$$;

revoke execute on function public.replace_project_costs(uuid,jsonb,text) from public, anon;
grant execute on function public.replace_project_costs(uuid,jsonb,text) to authenticated;
