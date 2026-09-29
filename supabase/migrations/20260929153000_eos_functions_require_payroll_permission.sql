-- دوال نهاية الخدمة تعمل بصلاحية المالك فتتخطى سياسات الوصول على الجداول.
-- بدون فحص صريح يقدر أي مستخدم مسجّل — المحاسب مثلاً — أن يستدعيها
-- ويستخرج مبالغ مشتقة من الرواتب. الفحص هنا يغلق هذا الباب.

create or replace function public.employee_eos_wage(p_employee uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when public.has_permission('payroll') then (
    select coalesce(c.basic_salary, 0) + coalesce((
      select sum(sc.amount) from public.salary_components sc
      where sc.contract_id = c.id and sc.kind = 'allowance' and sc.is_eos_applicable
    ), 0)
    from public.employment_contracts c
    where c.employee_id = p_employee and c.is_current
    limit 1
  ) end;
$$;

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
  if not public.has_permission('payroll') then
    return null;
  end if;

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
  if not public.has_permission('payroll') then
    return null;
  end if;

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

-- hr_setting تكشف النسب واللوائح فقط، لكنها تُستخدم داخل عرض التكلفة،
-- فتبقى للمسجّلين وتُقيَّد فعلياً بسياسات الجداول التي تقرأها الواجهة.
revoke all on function public.employee_eos_wage(uuid) from public, anon;
revoke all on function public.employee_eos_accrued(uuid, date) from public, anon;
revoke all on function public.employee_eos_entitlement(uuid, date, text) from public, anon;
grant execute on function public.employee_eos_wage(uuid) to authenticated;
grant execute on function public.employee_eos_accrued(uuid, date) to authenticated;
grant execute on function public.employee_eos_entitlement(uuid, date, text) to authenticated;
