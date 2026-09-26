-- تدقيق H-3: نقل تجميع مؤشّرات لوحة التحكم من JavaScript (9 استعلامات تجلب جداول
-- كاملة) إلى دالة واحدة في Postgres تُعيد صفّاً واحداً. يطابق منطق src/app/page.js
-- بالضبط (بما فيه تصنيف منظمات/خدمة عبر نفس نمط isOrganizersDescription).

create or replace function public.dashboard_metrics(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_organizers_regex constant text := 'منظمات?|منظّمات?|أدوات\s*الترتيب|ادوات\s*الترتيب|التخزين';
  v_active_statuses constant text[] := array['quote','preparing','in_progress'];

  v_period_revenue numeric := 0;
  v_period_project_costs numeric := 0;
  v_period_company_expenses numeric := 0;
  v_period_new_clients int := 0;
  v_period_billed numeric := 0;
  v_period_client_count int := 0;
  v_returning_clients int := 0;
  v_organizers_sales numeric := 0;
  v_service_sales numeric := 0;
  v_organizers_costs numeric := 0;
  v_period_bank_flow numeric := 0;
  v_period_payments_count int := 0;
  v_pending_company_expenses numeric := 0;

  v_active_projects int := 0;
  v_upcoming_count int := 0;
  v_low_stock_count int := 0;
  v_bank_balance numeric := 0;
  v_total_clients int := 0;
  v_bank_accounts_count int := 0;
begin
  select coalesce(sum(ip.amount), 0), count(*)
    into v_period_revenue, v_period_payments_count
  from public.invoice_payments ip
  join public.invoices i on i.id = ip.invoice_id
  where i.status <> 'refunded' and ip.paid_at >= p_from and ip.paid_at <= p_to;

  select coalesce(sum(pc.amount), 0) into v_period_project_costs
  from public.project_costs pc
  where coalesce(pc.work_date, pc.created_at) >= p_from and coalesce(pc.work_date, pc.created_at) <= p_to;

  select coalesce(sum(ce.amount), 0) into v_period_company_expenses
  from public.company_expenses ce
  where ce.payment_status = 'paid' and ce.expense_date >= p_from and ce.expense_date <= p_to;

  select coalesce(sum(ce.amount), 0) into v_pending_company_expenses
  from public.company_expenses ce
  where ce.payment_status = 'pending' and ce.expense_date >= p_from and ce.expense_date <= p_to;

  select count(*) into v_period_new_clients
  from public.clients c
  where coalesce(c.first_contact_at, c.created_at) >= p_from and coalesce(c.first_contact_at, c.created_at) <= p_to;

  select coalesce(sum(i.total), 0), count(distinct i.client_id)
    into v_period_billed, v_period_client_count
  from public.invoices i
  where i.status <> 'refunded' and i.issue_at >= p_from and i.issue_at <= p_to;

  select count(*) into v_returning_clients
  from (
    select distinct i.client_id
    from public.invoices i
    where i.status <> 'refunded' and i.issue_at >= p_from and i.issue_at <= p_to and i.client_id is not null
  ) period_clients
  where (select count(*) from public.invoices i2 where i2.status <> 'refunded' and i2.client_id = period_clients.client_id) > 1
     or (select count(*) from public.projects p2 where p2.client_id = period_clients.client_id) > 1;

  select
    coalesce(sum(case when coalesce(ii.description, '') ~* v_organizers_regex then ii.qty * ii.unit_price else 0 end), 0),
    coalesce(sum(case when not (coalesce(ii.description, '') ~* v_organizers_regex) then ii.qty * ii.unit_price else 0 end), 0)
    into v_organizers_sales, v_service_sales
  from public.invoice_items ii
  join public.invoices i on i.id = ii.invoice_id
  where i.status <> 'refunded' and i.issue_at >= p_from and i.issue_at <= p_to;

  select coalesce(sum(case
    when (coalesce(pc.product_name, '') || ' ' || coalesce(pc.label, '') || ' ' || coalesce(pc.note, '')) ~* v_organizers_regex
    then pc.amount else 0 end), 0)
    into v_organizers_costs
  from public.project_costs pc
  where coalesce(pc.work_date, pc.created_at) >= p_from and coalesce(pc.work_date, pc.created_at) <= p_to;

  select coalesce(sum(bt.amount), 0) into v_period_bank_flow
  from public.bank_transactions bt
  where bt.transaction_date >= p_from and bt.transaction_date <= p_to;

  select count(*) into v_active_projects from public.projects where status::text = any(v_active_statuses);

  select count(*) into v_upcoming_count
  from public.projects
  where status::text = any(v_active_statuses) and due_date is not null and (due_date::date - current_date) <= 14;

  select count(*) into v_low_stock_count
  from public.inventory_items where quantity < reorder_level;

  select coalesce(sum(ba.opening_balance), 0), count(*) into v_bank_balance, v_bank_accounts_count from public.bank_accounts ba;
  select v_bank_balance + coalesce(sum(bt.amount), 0) into v_bank_balance from public.bank_transactions bt;

  select count(*) into v_total_clients from public.clients where in_crm = true;

  return jsonb_build_object(
    'period_revenue', v_period_revenue,
    'period_payments_count', v_period_payments_count,
    'period_project_costs', v_period_project_costs,
    'period_company_expenses', v_period_company_expenses,
    'pending_company_expenses', v_pending_company_expenses,
    'period_new_clients', v_period_new_clients,
    'period_billed', v_period_billed,
    'period_client_count', v_period_client_count,
    'returning_clients', v_returning_clients,
    'organizers_sales', v_organizers_sales,
    'service_sales', v_service_sales,
    'organizers_costs', v_organizers_costs,
    'service_costs', v_period_project_costs - v_organizers_costs,
    'period_bank_flow', v_period_bank_flow,
    'active_projects', v_active_projects,
    'upcoming_count', v_upcoming_count,
    'low_stock_count', v_low_stock_count,
    'bank_balance', v_bank_balance,
    'bank_accounts_count', v_bank_accounts_count,
    'total_clients', v_total_clients
  );
end;
$$;

revoke all on function public.dashboard_metrics(timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_metrics(timestamptz, timestamptz) to authenticated;
