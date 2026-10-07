-- Adds the "finance_manager" role (مدير مالي) for app_user_access.role.
-- Unlike other roles, finance_manager is allowed to carry the restricted
-- "payroll" permission explicitly (assigned by name, not inherited from role).

alter table public.app_user_access
  drop constraint if exists app_user_access_role_check;

alter table public.app_user_access
  add constraint app_user_access_role_check
  check (role in ('admin','manager','accountant','finance_manager','operations','viewer'));
