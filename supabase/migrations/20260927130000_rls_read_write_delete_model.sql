-- 01 — نموذج صلاحيات read/write/delete على مستوى RLS.
-- المشكلة: كانت كل سياسات RLS (select/insert/update/delete) تستخدم نفس الشرط
-- has_permission(key)، فأي دور يملك مفتاح الوحدة يستطيع الكتابة والحذف — بما في
-- ذلك دور «المشاهدة فقط» (viewer). النتيجة: viewer يملك clients/projects يقدر
-- يعدّل ويحذف بيانات فعلية عبر REST أو التطبيق.
-- الحل: القراءة تبقى بشرط has_permission(key)، أما الكتابة والحذف فتشترط إضافةً
-- can_write() التي تمنع دور viewer. تُعاد بناء سياسات الكتابة/الحذف لكل الجداول
-- ديناميكياً مع الحفاظ على مفتاح الصلاحية لكل جدول.

-- بوابة الكتابة: المدير الأساسي، أو مستخدم فعّال دوره ليس viewer.
create or replace function public.can_write()
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    public.is_primary_admin()
    or exists (
      select 1
      from public.app_user_access aua
      where aua.user_id = (select auth.uid())
        and aua.active = true
        and aua.role <> 'viewer'
    );
$$;

revoke execute on function public.can_write() from public, anon;
grant execute on function public.can_write() to authenticated;

-- إعادة بناء سياسات الكتابة/الحذف لكل جدول يحمل النمط الموحّد، مع إضافة can_write().
do $$
declare
  r record;
  perm_key text;
begin
  for r in
    select tablename, policyname, cmd,
      (regexp_match(coalesce(with_check, qual), 'has_permission\(''([^'']+)''')) [1] as perm_key
    from pg_policies
    where schemaname = 'public'
      and policyname in ('permission_insert', 'permission_update', 'permission_delete')
  loop
    perm_key := r.perm_key;
    if perm_key is null then
      raise notice 'skipping %.% — could not derive permission key', r.tablename, r.policyname;
      continue;
    end if;

    execute format('drop policy %I on public.%I', r.policyname, r.tablename);

    if r.cmd = 'INSERT' then
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (public.has_permission(%L) and public.can_write())',
        r.policyname, r.tablename, perm_key);
    elsif r.cmd = 'UPDATE' then
      execute format(
        'create policy %I on public.%I for update to authenticated using (public.has_permission(%L) and public.can_write()) with check (public.has_permission(%L) and public.can_write())',
        r.policyname, r.tablename, perm_key, perm_key);
    elsif r.cmd = 'DELETE' then
      execute format(
        'create policy %I on public.%I for delete to authenticated using (public.has_permission(%L) and public.can_write())',
        r.policyname, r.tablename, perm_key);
    end if;
  end loop;
end $$;
