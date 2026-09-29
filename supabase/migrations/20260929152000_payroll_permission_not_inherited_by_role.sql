-- صلاحية الرواتب تُسنَد بالاسم لا بالمنصب: دور «مدير» وحده لا يكفي،
-- فلا يرث أي مدير يُضاف مستقبلاً بيانات الأجور دون قرار صريح.
create or replace function public.has_permission(permission_key text)
returns boolean
language sql
stable
set search_path to ''
as $function$
  select
    public.is_primary_admin()
    or exists (
      select 1
      from public.app_user_access aua
      where aua.user_id = (select auth.uid())
        and aua.active = true
        and (
          permission_key = any(aua.permissions)
          or (aua.role = 'admin' and permission_key <> 'payroll')
        )
    );
$function$;
