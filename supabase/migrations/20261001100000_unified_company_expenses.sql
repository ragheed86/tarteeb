-- Unified expense register: every Tarteeb expense lives in company_expenses,
-- classified as fixed / variable / project, with its funding account, origin,
-- and optional links to a project, employee and supplier.

alter table public.company_expenses
  add column if not exists cost_nature text not null default 'variable',
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  add column if not exists employee_id uuid references public.employees(id) on delete set null,
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null,
  add column if not exists account_id uuid references public.bank_accounts(id) on delete set null,
  add column if not exists source text not null default 'manual';

alter table public.company_expenses
  drop constraint if exists company_expenses_cost_nature_check,
  add constraint company_expenses_cost_nature_check
    check (cost_nature in ('fixed','variable','project'));

alter table public.company_expenses
  drop constraint if exists company_expenses_source_check,
  add constraint company_expenses_source_check
    check (source in ('manual','bank_reconciliation','import'));

-- Backfill before the project rule so existing rows stay valid.
update public.company_expenses
set cost_nature = case when recurrence <> 'none' then 'fixed' else 'variable' end
where cost_nature = 'variable';

update public.company_expenses
set source = 'bank_reconciliation'
where source = 'manual'
  and (note = 'أُنشئ من المطابقة البنكية' or note like 'مرجع البنك:%');

alter table public.company_expenses
  drop constraint if exists company_expenses_project_link_check,
  add constraint company_expenses_project_link_check
    check (cost_nature <> 'project' or project_id is not null);

-- Deleting a project nulls project_id (on delete set null). Without this the
-- project-link check would reject that update and block the project delete,
-- so a project expense whose project is gone becomes a variable expense.
create or replace function public.company_expense_unlink_project()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.project_id is null and new.cost_nature = 'project' then
    new.cost_nature := 'variable';
  end if;
  return new;
end;
$$;

drop trigger if exists company_expenses_unlink_project on public.company_expenses;
create trigger company_expenses_unlink_project
  before update of project_id on public.company_expenses
  for each row execute function public.company_expense_unlink_project();

revoke execute on function public.company_expense_unlink_project() from public, anon, authenticated;

create index if not exists company_expenses_project_idx on public.company_expenses(project_id) where project_id is not null;
create index if not exists company_expenses_employee_idx on public.company_expenses(employee_id) where employee_id is not null;
create index if not exists company_expenses_supplier_idx on public.company_expenses(supplier_id) where supplier_id is not null;
create index if not exists company_expenses_account_idx on public.company_expenses(account_id) where account_id is not null;
create index if not exists company_expenses_nature_idx on public.company_expenses(cost_nature);

-- Project profitability now includes expenses linked to the project.
-- Subqueries avoid row multiplication between the two cost sources.
create or replace view public.project_financials
with (security_invoker = true) as
select p.id as project_id,
       p.sale_price,
       coalesce(pc.cost, 0) + coalesce(ce.cost, 0)                       as total_cost,
       p.sale_price - (coalesce(pc.cost, 0) + coalesce(ce.cost, 0))      as net_profit,
       case when p.sale_price > 0
            then round((p.sale_price - (coalesce(pc.cost, 0) + coalesce(ce.cost, 0))) / p.sale_price * 100)
            else 0 end                                                   as margin_pct
from public.projects p
left join (
  select project_id, sum(amount) as cost
  from public.project_costs
  group by project_id
) pc on pc.project_id = p.id
left join (
  select project_id, sum(amount) as cost
  from public.company_expenses
  where project_id is not null
  group by project_id
) ce on ce.project_id = p.id;
