-- يربط حساب الدخول (app_user_access) بسجل الموظف المقابل اختياريًا،
-- لعرض صورة الموظف الفعلية في أسفل الشريط الجانبي بدل الحرف الأول فقط.
alter table public.app_user_access
  add column if not exists employee_id uuid references public.employees(id) on delete set null;

create index if not exists app_user_access_employee_idx
  on public.app_user_access(employee_id) where employee_id is not null;
