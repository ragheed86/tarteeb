-- Product images for warehouse inventory items.
alter table public.inventory_items
  add column if not exists image_url text,
  add column if not exists image_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  10485760,
  array['image/*']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists product_images_select on storage.objects;
create policy product_images_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'product-images'
    and (select public.has_permission('warehouse'))
  );

drop policy if exists product_images_insert on storage.objects;
create policy product_images_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (select public.has_permission('warehouse_products'))
  );

drop policy if exists product_images_update on storage.objects;
create policy product_images_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'product-images'
    and (select public.has_permission('warehouse_products'))
  )
  with check (
    bucket_id = 'product-images'
    and (select public.has_permission('warehouse_products'))
  );

drop policy if exists product_images_delete on storage.objects;
create policy product_images_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'product-images'
    and (select public.has_permission('warehouse_products'))
  );

