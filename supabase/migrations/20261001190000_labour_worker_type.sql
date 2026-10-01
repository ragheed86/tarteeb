-- نوع العامل على بنود العمالة: أساسي براتب (employee) أو بالساعة (part_time).
-- الأساسي تكلفته الفعلية في مسيّر الرواتب، وتُحمَّل على المشروع بسعر ساعة داخلي فقط
-- لحساب ربحية المشروع؛ فلا تُحسب مرتين في ربح الشركة (انظر dashboard_metrics).
-- البنود غير المصنّفة (null) تُعامل كتكلفة خارجية كما كانت، فلا تتغير أي أرقام قديمة.

alter table public.project_costs
  add column if not exists worker_type text check (worker_type in ('employee', 'part_time')),
  add column if not exists employee_id uuid references public.employees(id) on delete set null;

alter table public.project_costs drop constraint if exists project_costs_worker_type_labor_only;
alter table public.project_costs add constraint project_costs_worker_type_labor_only
  check (worker_type is null or kind = 'labor'::public.cost_kind) not valid;
alter table public.project_costs validate constraint project_costs_worker_type_labor_only;

create index if not exists idx_costs_employee on public.project_costs(employee_id) where employee_id is not null;

-- تعبئة قديمة: اسم يطابق موظفاً => أساسي، «فريلانسر» => بالساعة. الباقي يبقى بلا تصنيف.
update public.project_costs pc
set worker_type = 'employee', employee_id = e.id
from public.employees e
where pc.kind = 'labor'::public.cost_kind and pc.worker_type is null and pc.worker_name = e.name;

update public.project_costs
set worker_type = 'part_time'
where kind = 'labor'::public.cost_kind and worker_type is null
  and lower(coalesce(worker_name, '')) ~ '(فريلانسر|freelance)';

-- سعر ساعة الأساسيين = التكلفة الشهرية على الشركة ÷ ساعات العمل الشهرية (hr_settings، الافتراضي 208).
create or replace view public.employee_hourly_rates
with (security_invoker = on) as
select
  c.employee_id,
  c.name,
  round(c.gross_pay + c.gosi_employer + c.insurance_monthly + c.govt_fees_monthly
        + c.eos_accrual + c.ticket_accrual, 2) as monthly_employer_cost,
  coalesce(public.hr_setting('work_hours_per_month'), 208) as hours_per_month,
  round((c.gross_pay + c.gosi_employer + c.insurance_monthly + c.govt_fees_monthly
        + c.eos_accrual + c.ticket_accrual) / nullif(coalesce(public.hr_setting('work_hours_per_month'), 208), 0), 2) as hourly_cost
from public.employee_cost_current c
where c.status <> 'inactive' and c.contract_id is not null;

comment on view public.employee_hourly_rates is
  'سعر ساعة الموظف الأساسي لتحميله على المشاريع: التكلفة الشهرية الكاملة ÷ ساعات العمل الشهرية.';

-- حفظ التكاليف اليومية مع نوع العامل والموظف
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
  insert into public.project_costs (
    project_id, kind, label, amount, qty, hours, rate,
    work_date, note, worker_name, product_name, supplier_id, supplier_name,
    sale_price, markup_percent, worker_type, employee_id
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
    row_data.note,
    row_data.worker_name,
    row_data.product_name,
    row_data.supplier_id,
    row_data.supplier_name,
    row_data.sale_price,
    row_data.markup_percent,
    case when row_data.kind = 'labor' then row_data.worker_type end,
    case when row_data.kind = 'labor' and row_data.worker_type = 'employee' then row_data.employee_id end
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as row_data(
    kind text, label text, amount numeric, qty numeric, hours numeric, rate numeric,
    work_date date, note text, worker_name text, product_name text,
    supplier_id uuid, supplier_name text, sale_price numeric, markup_percent numeric,
    worker_type text, employee_id uuid
  )
  where row_data.kind in ('labor', 'materials', 'transport', 'bonus', 'other')
    and coalesce(row_data.amount, 0) > 0
    and (row_data.worker_type is null or row_data.worker_type in ('employee', 'part_time'))
  returning *;
end;
$$;

revoke execute on function public.replace_project_costs(uuid,jsonb,text) from public, anon;
grant execute on function public.replace_project_costs(uuid,jsonb,text) to authenticated;

-- نسبة تشغيل الأساسيين: ساعات المشاريع ÷ ساعات العمل المدفوعة في الشهر
create or replace function public.salaried_utilization(p_month date)
returns table (
  employee_id uuid, name text, paid_hours numeric, project_hours numeric, utilization_pct numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with m as (select date_trunc('month', p_month)::date as d),
  h as (select coalesce(public.hr_setting('work_hours_per_month', (select d from m)), 208) as paid)
  select
    r.employee_id,
    r.name,
    (select paid from h) as paid_hours,
    coalesce(sum(coalesce(pc.qty, 1) * coalesce(pc.hours, 0)), 0) as project_hours,
    round(coalesce(sum(coalesce(pc.qty, 1) * coalesce(pc.hours, 0)), 0) / nullif((select paid from h), 0) * 100, 1) as utilization_pct
  from public.employee_hourly_rates r
  left join public.project_costs pc
    on pc.employee_id = r.employee_id
   and pc.kind = 'labor'::public.cost_kind
   and pc.worker_type = 'employee'
   and pc.work_date >= (select d from m)
   and pc.work_date < (select d from m) + interval '1 month'
  group by r.employee_id, r.name
  order by r.name;
$$;
revoke execute on function public.salaried_utilization(date) from public, anon;
grant execute on function public.salaried_utilization(date) to authenticated;

-- مؤشرات لوحة التحكم: عمالة الأساسيين تُحمَّل على المشاريع داخلياً ولا تدخل تكلفة الشركة،
-- وبدلها تُحسب تكلفة الرواتب مرة واحدة من المسيّرات المقفلة.
-- نعيد تسمية الدالة الحالية (كما هي في الإنتاج) بدل إعادة كتابتها، ونغلّفها بدالة بنفس الاسم.
alter function public.dashboard_metrics(timestamptz, timestamptz) rename to dashboard_metrics_base;
revoke all on function public.dashboard_metrics_base(timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_metrics_base(timestamptz, timestamptz) to authenticated;

create or replace function public.dashboard_metrics(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_base jsonb;
  v_internal numeric := 0;
  v_payroll numeric := 0;
begin
  v_base := public.dashboard_metrics_base(p_from, p_to);

  select coalesce(sum(pc.amount), 0) into v_internal
  from public.project_costs pc
  where pc.kind = 'labor'::public.cost_kind and pc.worker_type = 'employee'
    and coalesce(pc.work_date, pc.created_at) >= p_from and coalesce(pc.work_date, pc.created_at) <= p_to;

  select coalesce(sum(r.total_employer_cost), 0) into v_payroll
  from public.payroll_runs r
  where r.status = 'locked' and r.period_month >= p_from::date and r.period_month <= p_to::date;

  return v_base
    || jsonb_build_object(
         'period_project_costs', (v_base->>'period_project_costs')::numeric - v_internal,
         'service_costs', (v_base->>'service_costs')::numeric - v_internal,
         'period_internal_labor', v_internal,
         'period_payroll_cost', v_payroll
       );
end;
$$;

revoke all on function public.dashboard_metrics(timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_metrics(timestamptz, timestamptz) to authenticated;
