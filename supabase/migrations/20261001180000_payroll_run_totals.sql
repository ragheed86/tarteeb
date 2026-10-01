-- HR payroll: keep payroll_runs totals in sync when a draft line is edited.
-- payroll_generate computes totals once at the end, but editing a line later
-- (other deductions, note) left the run header stale. Statement-level trigger
-- so generating N lines refreshes once, not N times.

create or replace function public.payroll_refresh_run_totals()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.payroll_runs r set
    total_gross = t.gross,
    total_deductions = t.deductions,
    total_net = t.net,
    total_employer_cost = t.cost
  from (
    select pl.run_id,
           coalesce(sum(pl.gross_pay), 0) as gross,
           coalesce(sum(pl.absence_deduction + pl.advance_installment + pl.other_deductions + pl.gosi_employee), 0) as deductions,
           coalesce(sum(pl.net_pay), 0) as net,
           coalesce(sum(pl.total_employer_cost), 0) as cost
    from public.payroll_lines pl
    where pl.run_id in (select run_id from changed_rows)
    group by pl.run_id
  ) t
  where r.id = t.run_id and r.status <> 'locked';
  return null;
end;
$$;

drop trigger if exists payroll_lines_totals_upd on public.payroll_lines;
create trigger payroll_lines_totals_upd
  after update on public.payroll_lines
  referencing new table as changed_rows
  for each statement execute function public.payroll_refresh_run_totals();

revoke execute on function public.payroll_refresh_run_totals() from public, anon, authenticated;
