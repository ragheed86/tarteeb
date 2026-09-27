-- تحسين أداء سياسات الكتابة: لفّ استدعاءات الدوال في (select ...) حتى تُحسب مرة
-- واحدة لكل عبارة (initplan) بدل مرة لكل صف — نمط Supabase الموصى به. هذا يمنع
-- بطء العمليات الجماعية (استيراد الحركات البنكية، حفظ بنود التكاليف...). لا يؤثر
-- على القراءة (سياسات SELECT كانت ملفوفة أصلاً).
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
    if perm_key is null then continue; end if;

    execute format('drop policy %I on public.%I', r.policyname, r.tablename);

    if r.cmd = 'INSERT' then
      execute format(
        'create policy %I on public.%I for insert to authenticated with check ((select public.has_permission(%L)) and (select public.can_write()))',
        r.policyname, r.tablename, perm_key);
    elsif r.cmd = 'UPDATE' then
      execute format(
        'create policy %I on public.%I for update to authenticated using ((select public.has_permission(%L)) and (select public.can_write())) with check ((select public.has_permission(%L)) and (select public.can_write()))',
        r.policyname, r.tablename, perm_key, perm_key);
    elsif r.cmd = 'DELETE' then
      execute format(
        'create policy %I on public.%I for delete to authenticated using ((select public.has_permission(%L)) and (select public.can_write()))',
        r.policyname, r.tablename, perm_key);
    end if;
  end loop;
end $$;
