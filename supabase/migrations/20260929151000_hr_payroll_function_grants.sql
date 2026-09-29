-- دوال المحفّزات ليست واجهة عامة: لا تُستدعى إلا من المحفّز نفسه.
revoke all on function public.payroll_line_guard() from public, anon, authenticated;
revoke all on function public.payroll_run_lock_guard() from public, anon, authenticated;
revoke all on function public.employee_allocation_guard() from public, anon, authenticated;

-- دوال الأجور تكشف مبالغ: تُمنع عن الزائر غير المسجّل، وتبقى للمسجّل
-- الذي تحكمه سياسات الوصول على الجداول.
revoke all on function public.hr_setting(text, date) from public, anon;
revoke all on function public.employee_eos_wage(uuid) from public, anon;
revoke all on function public.employee_eos_accrued(uuid, date) from public, anon;
revoke all on function public.employee_eos_entitlement(uuid, date, text) from public, anon;
revoke all on function public.payroll_generate(date) from anon;
revoke all on function public.payroll_lock(uuid) from anon;

grant execute on function public.hr_setting(text, date) to authenticated;
grant execute on function public.employee_eos_wage(uuid) to authenticated;
grant execute on function public.employee_eos_accrued(uuid, date) to authenticated;
grant execute on function public.employee_eos_entitlement(uuid, date, text) to authenticated;
grant execute on function public.payroll_generate(date) to authenticated;
grant execute on function public.payroll_lock(uuid) to authenticated;
