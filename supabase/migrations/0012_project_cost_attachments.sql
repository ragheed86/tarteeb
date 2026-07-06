-- مستندات مرفقة بتكلفة المشروع (فواتير موردين، إيصالات، مستندات أخرى) يرفعها المستخدم من /cost
create table if not exists public.project_cost_attachments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  file_name   text not null,
  file_url    text not null,
  file_path   text not null,
  file_type   text,
  file_size   bigint,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_cost_attachments_project on public.project_cost_attachments(project_id);

alter table public.project_cost_attachments enable row level security;

drop policy if exists permission_select on public.project_cost_attachments;
create policy permission_select on public.project_cost_attachments
  for select to authenticated using ((select public.has_permission('cost')));

drop policy if exists permission_insert on public.project_cost_attachments;
create policy permission_insert on public.project_cost_attachments
  for insert to authenticated with check ((select public.has_permission('cost')));

drop policy if exists permission_update on public.project_cost_attachments;
create policy permission_update on public.project_cost_attachments
  for update to authenticated using ((select public.has_permission('cost'))) with check ((select public.has_permission('cost')));

drop policy if exists permission_delete on public.project_cost_attachments;
create policy permission_delete on public.project_cost_attachments
  for delete to authenticated using ((select public.has_permission('cost')));

-- حاوية التخزين
insert into storage.buckets (id, name, public)
values ('project-cost-attachments', 'project-cost-attachments', true)
on conflict (id) do nothing;

drop policy if exists "cost_attachments_select" on storage.objects;
create policy "cost_attachments_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'project-cost-attachments' and (select public.has_permission('cost')));

drop policy if exists "cost_attachments_insert" on storage.objects;
create policy "cost_attachments_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-cost-attachments' and (select public.has_permission('cost')));

drop policy if exists "cost_attachments_update" on storage.objects;
create policy "cost_attachments_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'project-cost-attachments' and (select public.has_permission('cost')));

drop policy if exists "cost_attachments_delete" on storage.objects;
create policy "cost_attachments_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-cost-attachments' and (select public.has_permission('cost')));
