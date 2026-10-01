-- Fix: payroll_generate never worked. Its loop variable `r record` has the same
-- name as the table alias in the final `update public.payroll_runs r ...
-- where r.id = v_run`, so PL/pgSQL resolved r.id against the record variable
-- and raised 42703 ("record r has no field id") on every call. Only the alias
-- changes (r -> pr); the calculation is identical to 20260929150000_hr_payroll.

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

  update public.payroll_runs pr set
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
  where pr.id = v_run;

  return v_run;
end;
$$;
