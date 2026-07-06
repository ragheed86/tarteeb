-- Critical hardening:
-- 1) Replace broad authenticated_all policies with permission-backed RLS.
-- 2) Add database-generated client/invoice numbers.
-- 3) Make invoice creation and managed project-cost replacement atomic.
-- 4) Capture known schema drift for project_costs/client_source.

-- ---------- Schema drift captured from the live database ----------
alter type public.client_source add value if not exists 'client_referral';
alter type public.client_source add value if not exists 'employee_referral';

alter table public.project_costs add column if not exists qty numeric(12,2);
alter table public.project_costs add column if not exists hours numeric(12,2);
alter table public.project_costs add column if not exists rate numeric(12,2);

create index if not exists idx_invoices_project on public.invoices(project_id);

-- Views created by privileged roles should respect caller RLS.
alter view public.project_financials set (security_invoker = true);

-- ---------- Permission helpers ----------
create or replace function public.is_primary_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select lower(coalesce((select auth.jwt()) ->> 'email', '')) = 'r.kallajo@gmail.com';
$$;

create or replace function public.has_permission(permission_key text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    public.is_primary_admin()
    or exists (
      select 1
      from public.app_user_access aua
      where aua.user_id = (select auth.uid())
        and aua.active = true
        and (
          aua.role = 'admin'
          or permission_key = any(aua.permissions)
        )
    );
$$;

revoke execute on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

-- ---------- Replace broad table policies ----------
do $$
declare
  item text[];
  table_name text;
  permission_key text;
begin
  foreach item slice 1 in array array[
    array['company_settings','settings'],
    array['clients','clients'],
    array['employees','employees'],
    array['employee_documents','employees'],
    array['warehouses','warehouse'],
    array['categories','warehouse'],
    array['suppliers','warehouse'],
    array['inventory_items','warehouse'],
    array['projects','projects'],
    array['project_team','projects'],
    array['project_tasks','projects'],
    array['project_costs','cost'],
    array['project_media','projects'],
    array['invoices','invoices'],
    array['invoice_items','invoices'],
    array['partners','partners'],
    array['partner_transactions','partners'],
    array['communications','clients'],
    array['government_accounts','government'],
    array['dashboard_media','dashboard']
  ] loop
    table_name := item[1];
    permission_key := item[2];

    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists authenticated_all on public.%I', table_name);
    execute format('drop policy if exists permission_select on public.%I', table_name);
    execute format('drop policy if exists permission_insert on public.%I', table_name);
    execute format('drop policy if exists permission_update on public.%I', table_name);
    execute format('drop policy if exists permission_delete on public.%I', table_name);

    execute format(
      'create policy permission_select on public.%I for select to authenticated using ((select public.has_permission(%L)))',
      table_name,
      permission_key
    );
    execute format(
      'create policy permission_insert on public.%I for insert to authenticated with check ((select public.has_permission(%L)))',
      table_name,
      permission_key
    );
    execute format(
      'create policy permission_update on public.%I for update to authenticated using ((select public.has_permission(%L))) with check ((select public.has_permission(%L)))',
      table_name,
      permission_key,
      permission_key
    );
    execute format(
      'create policy permission_delete on public.%I for delete to authenticated using ((select public.has_permission(%L)))',
      table_name,
      permission_key
    );
  end loop;
end $$;

-- Keep access rows private to the user plus the primary admin.
drop policy if exists "users_can_read_own_access" on public.app_user_access;
create policy "users_can_read_own_access"
  on public.app_user_access
  for select to authenticated
  using ((select auth.uid()) = user_id or (select public.is_primary_admin()));

drop policy if exists "primary_admin_can_manage_access" on public.app_user_access;
create policy "primary_admin_can_manage_access"
  on public.app_user_access
  for all to authenticated
  using ((select public.is_primary_admin()))
  with check ((select public.is_primary_admin()));

-- ---------- Storage policy hardening for dashboard-media ----------
drop policy if exists "dashboard_media_read" on storage.objects;
create policy "dashboard_media_read"
  on storage.objects
  for select to authenticated
  using (bucket_id = 'dashboard-media' and (select public.has_permission('dashboard')));

drop policy if exists "dashboard_media_insert" on storage.objects;
create policy "dashboard_media_insert"
  on storage.objects
  for insert to authenticated
  with check (bucket_id = 'dashboard-media' and (select public.has_permission('dashboard')));

drop policy if exists "dashboard_media_update" on storage.objects;
create policy "dashboard_media_update"
  on storage.objects
  for update to authenticated
  using (bucket_id = 'dashboard-media' and (select public.has_permission('dashboard')))
  with check (bucket_id = 'dashboard-media' and (select public.has_permission('dashboard')));

drop policy if exists "dashboard_media_delete" on storage.objects;
create policy "dashboard_media_delete"
  on storage.objects
  for delete to authenticated
  using (bucket_id = 'dashboard-media' and (select public.has_permission('dashboard')));

-- ---------- Database-generated customer and invoice numbers ----------
create sequence if not exists public.clients_code_seq start 1;
grant usage, select on sequence public.clients_code_seq to authenticated, service_role;

select setval(
  'public.clients_code_seq',
  greatest(
    coalesce((select max(nullif(regexp_replace(code, '\D', '', 'g'), '')::bigint) from public.clients), 0),
    1
  ),
  coalesce((select max(nullif(regexp_replace(code, '\D', '', 'g'), '')::bigint) from public.clients), 0) > 0
);

create or replace function public.assign_client_code()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.code is null or btrim(new.code) = '' then
    new.code := 'TRT-' || lpad(nextval('public.clients_code_seq')::text, 3, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clients_assign_code on public.clients;
create trigger trg_clients_assign_code
  before insert on public.clients
  for each row execute function public.assign_client_code();

update public.clients
set code = 'TRT-' || lpad(nextval('public.clients_code_seq')::text, 3, '0')
where code is null or btrim(code) = '';

create sequence if not exists public.invoice_number_seq start 1001;
grant usage, select on sequence public.invoice_number_seq to authenticated, service_role;

select setval(
  'public.invoice_number_seq',
  greatest(
    coalesce((select max(nullif(regexp_replace(number, '\D', '', 'g'), '')::bigint) from public.invoices), 1000),
    1000
  ),
  true
);

create or replace function public.assign_invoice_number()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.number is null or btrim(new.number) = '' then
    new.number := 'INV-' || nextval('public.invoice_number_seq')::text;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invoices_assign_number on public.invoices;
create trigger trg_invoices_assign_number
  before insert on public.invoices
  for each row execute function public.assign_invoice_number();

update public.invoices
set number = 'INV-' || nextval('public.invoice_number_seq')::text
where number is null or btrim(number) = '';

-- ---------- Atomic finance operations ----------
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

  return created_invoice;
end;
$$;

revoke execute on function public.create_invoice_with_items(jsonb,jsonb) from public, anon;
grant execute on function public.create_invoice_with_items(jsonb,jsonb) to authenticated;

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
          coalesce(c.label, '') like 'يومي:%'
          or (
            (c.kind = 'labor'::public.cost_kind and (c.label in ('عمالة', 'إشراف') or coalesce(c.label, '') like 'عمالة:%'))
            or (c.kind = 'materials'::public.cost_kind and (c.label is null or coalesce(c.label, '') like 'منتج:%'))
            or (c.kind in ('materials'::public.cost_kind, 'transport'::public.cost_kind, 'other'::public.cost_kind) and c.label is null)
          )
        )
      )
      or (
        p_scope = 'estimate'
        and coalesce(c.label, '') not like 'يومي:%'
        and (
          (c.kind = 'labor'::public.cost_kind and (c.label in ('عمالة', 'إشراف') or coalesce(c.label, '') like 'عمالة:%'))
          or (c.kind = 'materials'::public.cost_kind and (c.label is null or coalesce(c.label, '') like 'منتج:%'))
          or (c.kind in ('materials'::public.cost_kind, 'transport'::public.cost_kind, 'other'::public.cost_kind) and c.label is null)
        )
      )
    );

  if coalesce(jsonb_array_length(coalesce(p_rows, '[]'::jsonb)), 0) = 0 then
    return;
  end if;

  return query
  insert into public.project_costs (project_id, kind, label, amount, qty, hours, rate)
  select
    p_project_id,
    row_data.kind::public.cost_kind,
    nullif(row_data.label, ''),
    coalesce(row_data.amount, 0),
    row_data.qty,
    row_data.hours,
    row_data.rate
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as row_data(
    kind text,
    label text,
    amount numeric,
    qty numeric,
    hours numeric,
    rate numeric
  )
  where row_data.kind in ('labor', 'materials', 'transport', 'bonus', 'other')
    and coalesce(row_data.amount, 0) > 0
  returning *;
end;
$$;

revoke execute on function public.replace_project_costs(uuid,jsonb,text) from public, anon;
grant execute on function public.replace_project_costs(uuid,jsonb,text) to authenticated;
