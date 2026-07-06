-- وسائط لوحة المعلومات: صور/فيديو مرفوعة إلى Supabase Storage
create table if not exists public.dashboard_media (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'image' check (kind in ('image','video')),
  file_url text not null,
  file_path text,
  caption text,
  created_at timestamptz not null default now()
);
alter table public.dashboard_media enable row level security;
drop policy if exists authenticated_all on public.dashboard_media;
create policy authenticated_all on public.dashboard_media for all to authenticated using (true) with check (true);

-- حاوية التخزين العامة
insert into storage.buckets (id, name, public)
values ('dashboard-media', 'dashboard-media', true)
on conflict (id) do nothing;

-- صلاحيات التخزين: قراءة عامة، وكتابة/حذف للمُصادَقين
drop policy if exists "dashboard_media_read" on storage.objects;
create policy "dashboard_media_read" on storage.objects for select to public using (bucket_id = 'dashboard-media');
drop policy if exists "dashboard_media_insert" on storage.objects;
create policy "dashboard_media_insert" on storage.objects for insert to authenticated with check (bucket_id = 'dashboard-media');
drop policy if exists "dashboard_media_update" on storage.objects;
create policy "dashboard_media_update" on storage.objects for update to authenticated using (bucket_id = 'dashboard-media');
drop policy if exists "dashboard_media_delete" on storage.objects;
create policy "dashboard_media_delete" on storage.objects for delete to authenticated using (bucket_id = 'dashboard-media');
