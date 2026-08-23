-- إغلاق الوصول العام للملفات الداخلية، وتسجيل مسارات التخزين الدائمة.
alter table public.employees add column if not exists photo_path text;
alter table public.government_accounts add column if not exists doc_path text;

update public.employees
set photo_path = split_part(photo_url, '/object/public/employee-photos/', 2)
where photo_path is null
  and photo_url like '%/object/public/employee-photos/%';

update public.government_accounts
set doc_path = split_part(doc_url, '/object/public/gov-documents/', 2)
where doc_path is null
  and doc_url like '%/object/public/gov-documents/%';

update public.dashboard_media
set file_path = split_part(file_url, '/object/public/dashboard-media/', 2)
where file_path is null
  and file_url like '%/object/public/dashboard-media/%';

update public.project_media
set file_path = split_part(file_url, '/object/public/project-media/', 2)
where file_path is null
  and file_url like '%/object/public/project-media/%';

update public.project_cost_attachments
set file_path = split_part(file_url, '/object/public/project-cost-attachments/', 2)
where (file_path is null or file_path = '')
  and file_url like '%/object/public/project-cost-attachments/%';

update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/*', 'video/mp4', 'video/webm', 'video/quicktime']::text[]
where id = 'dashboard-media';

update storage.buckets
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/*']::text[]
where id = 'employee-photos';

update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['application/pdf', 'image/*']::text[]
where id in ('gov-documents', 'project-cost-attachments');

update storage.buckets
set public = false,
    file_size_limit = 26214400,
    allowed_mime_types = array['image/*', 'video/mp4', 'video/webm', 'video/quicktime']::text[]
where id = 'project-media';

drop policy if exists employee_photos_read on storage.objects;
create policy employee_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'employee-photos' and (select public.has_permission('employees')));
drop policy if exists employee_photos_insert on storage.objects;
create policy employee_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'employee-photos' and (select public.has_permission('employees')));
drop policy if exists employee_photos_update on storage.objects;
create policy employee_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'employee-photos' and (select public.has_permission('employees')))
  with check (bucket_id = 'employee-photos' and (select public.has_permission('employees')));
drop policy if exists employee_photos_delete on storage.objects;
create policy employee_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'employee-photos' and (select public.has_permission('employees')));

drop policy if exists gov_documents_read on storage.objects;
create policy gov_documents_read on storage.objects for select to authenticated
  using (bucket_id = 'gov-documents' and (select public.has_permission('government')));
drop policy if exists gov_documents_insert on storage.objects;
create policy gov_documents_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'gov-documents' and (select public.has_permission('government')));
drop policy if exists gov_documents_update on storage.objects;
create policy gov_documents_update on storage.objects for update to authenticated
  using (bucket_id = 'gov-documents' and (select public.has_permission('government')))
  with check (bucket_id = 'gov-documents' and (select public.has_permission('government')));
drop policy if exists gov_documents_delete on storage.objects;
create policy gov_documents_delete on storage.objects for delete to authenticated
  using (bucket_id = 'gov-documents' and (select public.has_permission('government')));

drop policy if exists "cost_attachments_update" on storage.objects;
create policy "cost_attachments_update" on storage.objects for update to authenticated
  using (bucket_id = 'project-cost-attachments' and (select public.has_permission('cost')))
  with check (bucket_id = 'project-cost-attachments' and (select public.has_permission('cost')));

-- إصلاح تحذير search_path للدالة التي تلمس تاريخ تحديث عروض الأسعار.
create or replace function public.quotes_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- فهارس المفاتيح الخارجية المستخدمة في الربط والحذف المرجعي.
create index if not exists idx_clients_referred_by_client_id on public.clients(referred_by_client_id);
create index if not exists idx_clients_referred_by_employee_id on public.clients(referred_by_employee_id);
create index if not exists idx_inventory_items_supplier_id on public.inventory_items(supplier_id);
create index if not exists idx_partners_employee_id on public.partners(employee_id);
create index if not exists idx_project_team_employee_id on public.project_team(employee_id);
create index if not exists idx_projects_supervisor_id on public.projects(supervisor_id);
create index if not exists idx_quotes_invoice_id on public.quotes(invoice_id);

-- إزالة نسخة مطابقة تماماً من فهرس العميل في عروض الأسعار.
drop index if exists public.idx_quotes_client;

-- منع تراكب سياستي SELECT على جدول صلاحيات المستخدمين.
drop policy if exists "primary_admin_can_manage_access" on public.app_user_access;
drop policy if exists "users_can_read_own_access" on public.app_user_access;
create policy "users_can_read_own_access" on public.app_user_access
  for select to authenticated
  using ((select auth.uid()) = user_id or (select public.is_primary_admin()));
create policy "primary_admin_can_insert_access" on public.app_user_access
  for insert to authenticated with check ((select public.is_primary_admin()));
create policy "primary_admin_can_update_access" on public.app_user_access
  for update to authenticated
  using ((select public.is_primary_admin()))
  with check ((select public.is_primary_admin()));
create policy "primary_admin_can_delete_access" on public.app_user_access
  for delete to authenticated using ((select public.is_primary_admin()));
