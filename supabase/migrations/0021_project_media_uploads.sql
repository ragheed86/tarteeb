-- Project before/after media uploads.
alter table public.project_media
  add column if not exists file_path text;

insert into storage.buckets (id, name, public)
values ('project-media', 'project-media', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists project_media_read on storage.objects;
create policy project_media_read on storage.objects for select to authenticated
  using (bucket_id = 'project-media' and (select public.has_permission('projects')));

drop policy if exists project_media_insert on storage.objects;
create policy project_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'project-media' and (select public.has_permission('projects')));

drop policy if exists project_media_update on storage.objects;
create policy project_media_update on storage.objects for update to authenticated
  using (bucket_id = 'project-media' and (select public.has_permission('projects')))
  with check (bucket_id = 'project-media' and (select public.has_permission('projects')));

drop policy if exists project_media_delete on storage.objects;
create policy project_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'project-media' and (select public.has_permission('projects')));
