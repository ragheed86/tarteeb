-- حاوية تخزين عامة لصور الموظفين + سياسات RLS مرتبطة بصلاحية employees
insert into storage.buckets (id, name, public)
values ('employee-photos', 'employee-photos', true)
on conflict (id) do nothing;

create policy employee_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'employee-photos' and (select has_permission('employees')));
create policy employee_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'employee-photos' and (select has_permission('employees')));
create policy employee_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'employee-photos' and (select has_permission('employees')))
  with check (bucket_id = 'employee-photos' and (select has_permission('employees')));
create policy employee_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'employee-photos' and (select has_permission('employees')));
