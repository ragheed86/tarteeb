-- وحدة الموارد البشرية والرواتب حسب نظام العمل السعودي.
-- المبدأ: الموظف ليس سجل بيانات بل محرك تكلفة. كل موظف يُخرج رقمين:
-- التكلفة الشهرية الفعلية على الشركة، وتكلفة الساعة التي تُحمَّل على المشاريع.
-- كل النسب والرسوم في hr_settings بتاريخ سريان، فلا تُعدَّل اللوائح في الكود
-- ولا تتغيّر أرقام المسيّرات القديمة عند تغيّر النسب.

-- ===== 1) بيانات التوظيف الأساسية على الموظف =====
alter table public.employees
  add column if not exists hire_date date,
  add column if not exists termination_date date,
  add column if not exists termination_reason text
    check (termination_reason is null or termination_reason in ('resignation', 'employer_termination', 'contract_end', 'other')),
  add column if not exists iban text,
  add column if not exists gosi_number text,
  add column if not exists is_billable boolean not null default true;

comment on column public.employees.is_billable is
  'يُوزَّع على المشاريع افتراضياً. رغيد ودلال = false فتذهب تكلفتهما للإدارة العامة وتُنزَّل يدوياً عند الحاجة.';

-- ===== 2) إعدادات النسب والرسوم بتاريخ سريان =====
create table public.hr_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null check (char_length(trim(key)) > 0),
  value numeric(14,4) not null,
  effective_from date not null default current_date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (key, effective_from)
);

create index hr_settings_key_idx on public.hr_settings(key, effective_from desc);

-- القيمة السارية لمفتاح في تاريخ معيّن. آخر سطر سريانه قبل التاريخ أو عنده.
create or replace function public.hr_setting(p_key text, p_on date default current_date)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.value
  from public.hr_settings s
  where s.key = p_key and s.effective_from <= coalesce(p_on, current_date)
  order by s.effective_from desc
  limit 1;
$$;

insert into public.hr_settings (key, value, effective_from, note) values
  ('gosi_employer_saudi_percent', 11.75, '2025-07-01', 'حصة صاحب العمل للسعودي: معاشات + ساند'),
  ('gosi_employee_saudi_percent', 9.75,  '2025-07-01', 'حصة الموظف السعودي'),
  ('gosi_employer_expat_percent', 2,     '2025-07-01', 'أخطار مهنية على صاحب العمل لغير السعودي'),
  ('gosi_employee_expat_percent', 0,     '2025-07-01', 'لا حصة موظف لغير السعودي'),
  ('gosi_salary_cap', 45000,             '2025-07-01', 'سقف الأجر الخاضع للتأمينات'),
  ('expat_levy_monthly', 800,            '2025-07-01', 'المقابل المالي الشهري للعامل الوافد'),
  ('max_deduction_percent', 50,          '2025-07-01', 'سقف مجموع الاستقطاعات من الأجر'),
  ('personal_debt_deduction_percent', 10,'2025-07-01', 'سقف حسم الدين الشخصي من الأجر'),
  ('days_per_month', 30,                 '2025-07-01', 'أيام الشهر لاحتساب الأجر اليومي'),
  ('work_hours_per_month', 208,          '2025-07-01', 'ساعات العمل الشهرية لاحتساب تكلفة الساعة'),
  ('annual_leave_days', 21,              '2025-07-01', 'رصيد الإجازة السنوية لأول خمس سنوات');

-- ===== 3) العقود =====
-- العقد كيان مستقل عن الموظف لأنه يتجدد ويتعدّل، والتاريخ كله مطلوب
-- لاحتساب نهاية الخدمة ولتفسير أي مسيّر قديم.
create table public.employment_contracts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  contract_type text not null default 'unlimited'
    check (contract_type in ('unlimited', 'limited', 'part_time', 'freelance')),
  start_date date not null,
  end_date date,
  probation_end_date date,
  basic_salary numeric(14,2) not null default 0 check (basic_salary >= 0),
  medical_insurance_yearly numeric(14,2) not null default 0 check (medical_insurance_yearly >= 0),
  govt_fees_yearly numeric(14,2) not null default 0 check (govt_fees_yearly >= 0),
  ticket_yearly numeric(14,2) not null default 0 check (ticket_yearly >= 0),
  is_current boolean not null default true,
  note text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contract_end_after_start check (end_date is null or end_date >= start_date)
);

comment on column public.employment_contracts.govt_fees_yearly is
  'رسوم حكومية سنوية للوافد غير المقابل المالي: الإقامة ورخصة العمل. تُقسَّط على 12 شهراً في التكلفة.';

create unique index employment_contracts_one_current_idx
  on public.employment_contracts(employee_id) where is_current;
create index employment_contracts_employee_idx
  on public.employment_contracts(employee_id, start_date desc);

-- ===== 4) مكونات الأجر =====
-- العلَمان أدناه أهم خانتين في الوحدة: بدونهما تخرج التأمينات ونهاية الخدمة غلطاً.
create table public.salary_components (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.employment_contracts(id) on delete cascade,
  kind text not null check (kind in ('allowance', 'deduction')),
  name text not null check (char_length(trim(name)) > 0),
  amount numeric(14,2) not null check (amount >= 0),
  is_gosi_applicable boolean not null default false,
  is_eos_applicable boolean not null default false,
  is_recurring boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index salary_components_contract_idx on public.salary_components(contract_id);

-- ===== 5) الإجازات والغياب (استثناءات فقط، الأصل أن الموظف حاضر) =====
create table public.leave_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type text not null
    check (leave_type in ('annual', 'sick', 'unpaid', 'absence', 'maternity', 'hajj', 'marriage', 'bereavement')),
  from_date date not null,
  to_date date not null,
  days numeric(6,2) not null check (days > 0),
  paid_ratio numeric(5,2) not null default 100 check (paid_ratio between 0 and 100),
  note text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leave_end_after_start check (to_date >= from_date)
);

comment on column public.leave_records.paid_ratio is
  'نسبة الأجر المدفوع: 100 للإجازة السنوية، 0 للغياب وبدون أجر، 75 للمرضي بعد أول 30 يوماً.';

create index leave_records_employee_idx on public.leave_records(employee_id, from_date desc);
create index leave_records_period_idx on public.leave_records(from_date, to_date);

-- ===== 6) السلف =====
create table public.employee_advances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  installments_count smallint not null default 1 check (installments_count between 1 and 60),
  monthly_installment numeric(14,2) not null check (monthly_installment > 0),
  start_month date not null,
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  status text not null default 'active' check (status in ('active', 'settled', 'cancelled')),
  note text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index employee_advances_employee_idx on public.employee_advances(employee_id, start_month desc);
create index employee_advances_open_idx on public.employee_advances(employee_id) where status = 'active';

-- ===== 7) توزيع الموظفين على المشاريع =====
create table public.employee_project_allocations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  period_month date not null,
  allocation_percent numeric(5,2) not null check (allocation_percent > 0 and allocation_percent <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, project_id, period_month)
);

create index employee_allocations_month_idx on public.employee_project_allocations(period_month, employee_id);
create index employee_allocations_project_idx on public.employee_project_allocations(project_id, period_month);

-- منع تجاوز 100% لنفس الموظف في نفس الشهر.
create or replace function public.employee_allocation_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total numeric(7,2);
begin
  select coalesce(sum(allocation_percent), 0) into v_total
    from public.employee_project_allocations
    where employee_id = new.employee_id
      and period_month = new.period_month
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);
  if v_total + new.allocation_percent > 100.009 then
    raise exception 'مجموع توزيع الموظف على المشاريع في هذا الشهر % بالمئة، ولا يمكن تجاوز 100',
      to_char(v_total + new.allocation_percent, 'FM999.99');
  end if;
  return new;
end;
$$;

create trigger employee_allocation_limit
  before insert or update on public.employee_project_allocations
  for each row execute function public.employee_allocation_guard();

-- ===== 8) مسيّر الرواتب =====
-- المسيّر سجل مجمّد: تُحسب الأرقام مرة واحدة وتُخزَّن. لو حُسبت لحظياً
-- لغيّر أي تعديل على راتب اليوم تاريخ الشركة المالي كله.
create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  period_month date not null unique,
  status text not null default 'draft' check (status in ('draft', 'approved', 'locked')),
  total_gross numeric(14,2) not null default 0,
  total_deductions numeric(14,2) not null default 0,
  total_net numeric(14,2) not null default 0,
  total_employer_cost numeric(14,2) not null default 0,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  exported_at timestamptz,
  note text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payroll_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  -- لقطة مجمّدة من العقد وقت الاحتساب
  basic_salary numeric(14,2) not null default 0,
  allowances numeric(14,2) not null default 0,
  gross_pay numeric(14,2) not null default 0,
  absence_days numeric(6,2) not null default 0,
  absence_deduction numeric(14,2) not null default 0,
  advance_installment numeric(14,2) not null default 0,
  other_deductions numeric(14,2) not null default 0,
  gosi_employee numeric(14,2) not null default 0,
  net_pay numeric(14,2) not null default 0 check (net_pay >= 0),
  -- تكلفة صاحب العمل
  gosi_employer numeric(14,2) not null default 0,
  insurance_monthly numeric(14,2) not null default 0,
  govt_fees_monthly numeric(14,2) not null default 0,
  eos_accrual numeric(14,2) not null default 0,
  ticket_accrual numeric(14,2) not null default 0,
  total_employer_cost numeric(14,2) not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, employee_id)
);

create index payroll_lines_employee_idx on public.payroll_lines(employee_id);

-- سقف الاستقطاع النظامي: فحص برمجي يوقف المسيّر، لا تنبيه يمكن تجاوزه.
-- التأمينات استقطاع نظامي فلا تدخل في السقف، وحسم الغياب أجر غير مستحق لا استقطاع.
create or replace function public.payroll_line_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cap_percent numeric;
  v_earned numeric(14,2);
  v_deductions numeric(14,2);
  v_month date;
  v_status text;
  v_name text;
begin
  select r.period_month, r.status into v_month, v_status
    from public.payroll_runs r where r.id = new.run_id;

  if v_status = 'locked' then
    raise exception 'المسيّر مقفل ولا يقبل التعديل';
  end if;

  v_cap_percent := coalesce(public.hr_setting('max_deduction_percent', v_month), 50);
  v_earned := new.gross_pay - new.absence_deduction;
  v_deductions := new.advance_installment + new.other_deductions;

  if v_earned > 0 and v_deductions > (v_earned * v_cap_percent / 100) + 0.009 then
    select e.name into v_name from public.employees e where e.id = new.employee_id;
    raise exception 'استقطاعات % تتجاوز % بالمئة من الأجر المستحق (% من %). خفّض قسط السلفة.',
      coalesce(v_name, 'الموظف'),
      to_char(v_cap_percent, 'FM999'),
      to_char(v_deductions, 'FM999999.99'),
      to_char(v_earned, 'FM999999.99');
  end if;

  new.net_pay := greatest(v_earned - v_deductions - new.gosi_employee, 0);
  new.total_employer_cost := new.gross_pay - new.absence_deduction
    + new.gosi_employer + new.insurance_monthly + new.govt_fees_monthly
    + new.eos_accrual + new.ticket_accrual;
  return new;
end;
$$;

create trigger payroll_line_limits
  before insert or update on public.payroll_lines
  for each row execute function public.payroll_line_guard();

-- منع تعديل أو حذف مسيّر مقفل.
create or replace function public.payroll_run_lock_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'locked' then
      raise exception 'لا يمكن حذف مسيّر مقفل';
    end if;
    return old;
  end if;
  if old.status = 'locked' and new.status = 'locked'
     and (new.total_net <> old.total_net or new.period_month <> old.period_month) then
    raise exception 'المسيّر مقفل ولا تُعدَّل أرقامه';
  end if;
  if old.status = 'locked' and new.status <> 'locked' then
    raise exception 'لا يمكن إعادة فتح مسيّر مقفل';
  end if;
  return new;
end;
$$;

create trigger payroll_run_lock
  before update or delete on public.payroll_runs
  for each row execute function public.payroll_run_lock_guard();

-- ===== 9) الدوال المالية =====

-- أجر نهاية الخدمة: الأساسي + المكونات المعلَّمة أنها تدخل في الحساب.
create or replace function public.employee_eos_wage(p_employee uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(c.basic_salary, 0) + coalesce((
    select sum(sc.amount) from public.salary_components sc
    where sc.contract_id = c.id and sc.kind = 'allowance' and sc.is_eos_applicable
  ), 0)
  from public.employment_contracts c
  where c.employee_id = p_employee and c.is_current
  limit 1;
$$;

-- مخصص نهاية الخدمة المتراكم: نصف أجر شهر عن كل سنة من الخمس الأولى،
-- وأجر شهر كامل عن كل سنة بعدها، محسوباً على آخر أجر. التزام قائم من أول شهر
-- لا حدث يقع آخر الخدمة.
create or replace function public.employee_eos_accrued(p_employee uuid, p_as_of date default current_date)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_start date;
  v_years numeric;
  v_wage numeric;
begin
  select coalesce(e.hire_date, c.start_date) into v_start
    from public.employees e
    left join public.employment_contracts c on c.employee_id = e.id and c.is_current
    where e.id = p_employee;
  if v_start is null then return 0; end if;

  v_wage := coalesce(public.employee_eos_wage(p_employee), 0);
  v_years := extract(epoch from (coalesce(p_as_of, current_date)::timestamp - v_start::timestamp)) / 31557600.0;
  if v_years <= 0 or v_wage <= 0 then return 0; end if;

  if v_years <= 5 then
    return round(v_wage * 0.5 * v_years, 2);
  end if;
  return round(v_wage * (2.5 + (v_years - 5)), 2);
end;
$$;

-- المستحق فعلياً عند انتهاء الخدمة. الاستقالة لها سلّم مختلف عن إنهاء صاحب العمل.
create or replace function public.employee_eos_entitlement(
  p_employee uuid,
  p_as_of date default current_date,
  p_reason text default 'employer_termination'
)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_start date;
  v_years numeric;
  v_accrued numeric;
begin
  v_accrued := public.employee_eos_accrued(p_employee, p_as_of);
  if coalesce(p_reason, 'employer_termination') <> 'resignation' then
    return v_accrued;
  end if;

  select coalesce(e.hire_date, c.start_date) into v_start
    from public.employees e
    left join public.employment_contracts c on c.employee_id = e.id and c.is_current
    where e.id = p_employee;
  if v_start is null then return 0; end if;
  v_years := extract(epoch from (coalesce(p_as_of, current_date)::timestamp - v_start::timestamp)) / 31557600.0;

  if v_years < 2 then return 0; end if;
  if v_years < 5 then return round(v_accrued / 3, 2); end if;
  if v_years < 10 then return round(v_accrued * 2 / 3, 2); end if;
  return v_accrued;
end;
$$;

-- ===== 10) عرض التكلفة الحالية لكل موظف =====
-- الرقم الذي تقوم عليه الوحدة: ما يكلّفه الموظف فعلاً على الشركة كل شهر.
create view public.employee_cost_current
with (security_invoker = on)
as
select
  e.id as employee_id,
  e.name,
  e.status,
  e.nationality,
  (coalesce(e.nationality, '') = 'SA') as is_saudi,
  e.is_billable,
  e.hire_date,
  c.id as contract_id,
  coalesce(c.basic_salary, 0) as basic_salary,
  coalesce(a.allowances, 0) as allowances,
  coalesce(c.basic_salary, 0) + coalesce(a.allowances, 0) as gross_pay,
  round(
    least(
      coalesce(c.basic_salary, 0) + coalesce(a.gosi_allowances, 0),
      coalesce(public.hr_setting('gosi_salary_cap'), 45000)
    ) * coalesce(
      case when coalesce(e.nationality, '') = 'SA'
        then public.hr_setting('gosi_employer_saudi_percent')
        else public.hr_setting('gosi_employer_expat_percent') end, 0) / 100, 2) as gosi_employer,
  round(
    least(
      coalesce(c.basic_salary, 0) + coalesce(a.gosi_allowances, 0),
      coalesce(public.hr_setting('gosi_salary_cap'), 45000)
    ) * coalesce(
      case when coalesce(e.nationality, '') = 'SA'
        then public.hr_setting('gosi_employee_saudi_percent')
        else public.hr_setting('gosi_employee_expat_percent') end, 0) / 100, 2) as gosi_employee,
  round(coalesce(c.medical_insurance_yearly, 0) / 12, 2) as insurance_monthly,
  round(
    case when coalesce(e.nationality, '') = 'SA' then 0
      else coalesce(public.hr_setting('expat_levy_monthly'), 0) + coalesce(c.govt_fees_yearly, 0) / 12 end, 2) as govt_fees_monthly,
  round(coalesce(c.ticket_yearly, 0) / 12, 2) as ticket_accrual,
  round(
    coalesce(public.employee_eos_wage(e.id), 0)
    * case when coalesce(e.hire_date, c.start_date) is null then 0
        when (current_date - coalesce(e.hire_date, c.start_date)) > 1826 then 1 else 0.5 end
    / 12, 2) as eos_accrual,
  public.employee_eos_accrued(e.id) as eos_accrued_total
from public.employees e
left join public.employment_contracts c on c.employee_id = e.id and c.is_current
left join lateral (
  select
    sum(sc.amount) filter (where sc.kind = 'allowance') as allowances,
    sum(sc.amount) filter (where sc.kind = 'allowance' and sc.is_gosi_applicable) as gosi_allowances
  from public.salary_components sc
  where sc.contract_id = c.id and sc.is_recurring
) a on true;

comment on view public.employee_cost_current is
  'التكلفة الشهرية الفعلية لكل موظف: الأجر + حصة الشركة من التأمينات + التأمين الطبي + الرسوم الحكومية + مخصص نهاية الخدمة + التذاكر.';

-- ===== 11) احتساب المسيّر الشهري =====
-- يبني مسودة المسيّر من العقود السارية، ويطبّق حسم الغياب وأقساط السلف.
create or replace function public.payroll_generate(p_month date)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_run uuid;
  v_status text;
  v_days numeric;
  r record;
  v_absence_days numeric;
  v_absence numeric;
  v_advance numeric;
  v_daily numeric;
begin
  if not public.has_permission('payroll') then
    raise exception 'لا تملك صلاحية الرواتب';
  end if;

  select id, status into v_run, v_status from public.payroll_runs where period_month = v_month;
  if v_status = 'locked' then
    raise exception 'مسيّر هذا الشهر مقفل';
  end if;
  if v_run is null then
    insert into public.payroll_runs (period_month) values (v_month) returning id into v_run;
  else
    delete from public.payroll_lines where run_id = v_run;
  end if;

  v_days := coalesce(public.hr_setting('days_per_month', v_month), 30);

  for r in
    select * from public.employee_cost_current
    where status <> 'inactive' and contract_id is not null
  loop
    v_daily := case when v_days > 0 then r.gross_pay / v_days else 0 end;

    select coalesce(sum(l.days * (100 - l.paid_ratio) / 100), 0) into v_absence_days
      from public.leave_records l
      where l.employee_id = r.employee_id
        and l.from_date <= (v_month + interval '1 month - 1 day')::date
        and l.to_date >= v_month;
    v_absence := round(v_daily * v_absence_days, 2);

    select coalesce(sum(least(adv.monthly_installment, adv.amount - adv.paid_amount)), 0) into v_advance
      from public.employee_advances adv
      where adv.employee_id = r.employee_id
        and adv.status = 'active'
        and adv.start_month <= v_month
        and adv.amount > adv.paid_amount;

    insert into public.payroll_lines (
      run_id, employee_id, basic_salary, allowances, gross_pay,
      absence_days, absence_deduction, advance_installment, gosi_employee,
      gosi_employer, insurance_monthly, govt_fees_monthly, eos_accrual, ticket_accrual
    ) values (
      v_run, r.employee_id, r.basic_salary, r.allowances, r.gross_pay,
      v_absence_days, v_absence, v_advance, r.gosi_employee,
      r.gosi_employer, r.insurance_monthly, r.govt_fees_monthly, r.eos_accrual, r.ticket_accrual
    );
  end loop;

  update public.payroll_runs r set
    status = 'draft',
    total_gross = t.gross,
    total_deductions = t.deductions,
    total_net = t.net,
    total_employer_cost = t.cost
  from (
    select
      coalesce(sum(gross_pay), 0) as gross,
      coalesce(sum(absence_deduction + advance_installment + other_deductions + gosi_employee), 0) as deductions,
      coalesce(sum(net_pay), 0) as net,
      coalesce(sum(total_employer_cost), 0) as cost
    from public.payroll_lines where run_id = v_run
  ) t
  where r.id = v_run;

  return v_run;
end;
$$;

-- إقفال المسيّر: يجمّد الأرقام ويحدّث أرصدة السلف. الإقفال شرط التصدير
-- إلى نظام حماية الأجور، وبعده لا يُعدَّل شيء.
create or replace function public.payroll_lock(p_run uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_missing int;
begin
  if not public.has_permission('payroll') then
    raise exception 'لا تملك صلاحية الرواتب';
  end if;

  select status into v_status from public.payroll_runs where id = p_run;
  if v_status is null then raise exception 'المسيّر غير موجود'; end if;
  if v_status = 'locked' then raise exception 'المسيّر مقفل أصلاً'; end if;

  -- حماية الأجور تفرض الآيبان ورقم الهوية قبل التصدير.
  select count(*) into v_missing
    from public.payroll_lines pl
    join public.employees e on e.id = pl.employee_id
    where pl.run_id = p_run
      and (coalesce(trim(e.iban), '') = '' or coalesce(trim(e.national_id), '') = '');
  if v_missing > 0 then
    raise exception 'يوجد % موظف بلا آيبان أو رقم هوية. حماية الأجور لا تقبل التصدير بدونهما.', v_missing;
  end if;

  update public.employee_advances adv set
    paid_amount = least(adv.amount, adv.paid_amount + pl.advance_installment),
    status = case when adv.paid_amount + pl.advance_installment >= adv.amount - 0.009 then 'settled' else adv.status end
  from public.payroll_lines pl
  where pl.run_id = p_run and pl.employee_id = adv.employee_id
    and adv.status = 'active' and pl.advance_installment > 0;

  update public.payroll_runs
    set status = 'locked', approved_by = auth.uid(), approved_at = now()
    where id = p_run;
end;
$$;

-- ===== 12) المحفّزات والصلاحيات =====
create trigger hr_settings_set_updated_at before update on public.hr_settings
  for each row execute function public.set_updated_at();
create trigger employment_contracts_set_updated_at before update on public.employment_contracts
  for each row execute function public.set_updated_at();
create trigger salary_components_set_updated_at before update on public.salary_components
  for each row execute function public.set_updated_at();
create trigger leave_records_set_updated_at before update on public.leave_records
  for each row execute function public.set_updated_at();
create trigger employee_advances_set_updated_at before update on public.employee_advances
  for each row execute function public.set_updated_at();
create trigger employee_allocations_set_updated_at before update on public.employee_project_allocations
  for each row execute function public.set_updated_at();
create trigger payroll_runs_set_updated_at before update on public.payroll_runs
  for each row execute function public.set_updated_at();
create trigger payroll_lines_set_updated_at before update on public.payroll_lines
  for each row execute function public.set_updated_at();

alter table public.hr_settings enable row level security;
alter table public.employment_contracts enable row level security;
alter table public.salary_components enable row level security;
alter table public.leave_records enable row level security;
alter table public.employee_advances enable row level security;
alter table public.employee_project_allocations enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_lines enable row level security;

-- بيانات الأجور معزولة عن بقية النظام بصلاحية مستقلة.
-- الإجازات والتوزيع على المشاريع تكفيها صلاحية الموظفين لأنها لا تكشف مبالغ.
do $$
declare
  t text;
begin
  foreach t in array array[
    'hr_settings', 'employment_contracts', 'salary_components',
    'employee_advances', 'payroll_runs', 'payroll_lines'
  ] loop
    execute format('create policy payroll_select on public.%I for select to authenticated using ((select public.has_permission(''payroll'')))', t);
    execute format('create policy payroll_insert on public.%I for insert to authenticated with check ((select public.has_permission(''payroll'')))', t);
    execute format('create policy payroll_update on public.%I for update to authenticated using ((select public.has_permission(''payroll''))) with check ((select public.has_permission(''payroll'')))', t);
    execute format('create policy payroll_delete on public.%I for delete to authenticated using ((select public.has_permission(''payroll'')))', t);
  end loop;

  foreach t in array array['leave_records', 'employee_project_allocations'] loop
    execute format('create policy employees_select on public.%I for select to authenticated using ((select public.has_permission(''employees'')))', t);
    execute format('create policy employees_insert on public.%I for insert to authenticated with check ((select public.has_permission(''employees'')))', t);
    execute format('create policy employees_update on public.%I for update to authenticated using ((select public.has_permission(''employees''))) with check ((select public.has_permission(''employees'')))', t);
    execute format('create policy employees_delete on public.%I for delete to authenticated using ((select public.has_permission(''employees'')))', t);
  end loop;
end $$;

grant select, insert, update, delete on
  public.hr_settings, public.employment_contracts, public.salary_components,
  public.leave_records, public.employee_advances, public.employee_project_allocations,
  public.payroll_runs, public.payroll_lines
  to authenticated;
grant select on public.employee_cost_current to authenticated;

revoke all on function public.payroll_generate(date) from public;
revoke all on function public.payroll_lock(uuid) from public;
grant execute on function public.payroll_generate(date) to authenticated;
grant execute on function public.payroll_lock(uuid) to authenticated;
grant execute on function public.hr_setting(text, date) to authenticated;
grant execute on function public.employee_eos_wage(uuid) to authenticated;
grant execute on function public.employee_eos_accrued(uuid, date) to authenticated;
grant execute on function public.employee_eos_entitlement(uuid, date, text) to authenticated;

-- صلاحية الرواتب لرغيد ودلال فقط، لا لبقية الأدوار.
update public.app_user_access
set permissions = (
  select array_agg(distinct permission)
  from unnest(permissions || array['payroll']::text[]) as permission
)
where lower(email) in ('r.kallajo@gmail.com', 'daljawini@yahoo.com');

-- رغيد ودلال لا يُوزَّعان على المشاريع افتراضياً، بل يدوياً عند الحاجة.
update public.employees set is_billable = false
where name in ('رغيد قلاجو', 'دلال الجعويني');
