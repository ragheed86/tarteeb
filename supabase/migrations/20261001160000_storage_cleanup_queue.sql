-- CRM-AUD-07: keep Storage files and database rows consistent.
--
-- Storage and Postgres can't share one transaction. Before this change the app
-- deleted the file first and swallowed errors, so a failure could leave a row
-- pointing at a missing file, or a file nobody references.
--
-- Now:
-- 1. When a row that owns a file is deleted, or its path column changes, a
--    trigger queues the old path in storage_cleanup_queue IN THE SAME
--    TRANSACTION as the row change. A rolled-back delete queues nothing.
-- 2. The app then claims queued items it has permission for, deletes the file,
--    and reports success or failure. Failures are retried with backoff.
-- 3. A file is never deleted while any row still references it (checked at
--    claim time), so retries and duplicate queue entries are safe.
-- 4. If an upload succeeds but saving the row fails, the app queues the
--    orphan (after a short delay) when it can't remove it directly.

create table if not exists public.storage_cleanup_queue (
  id bigint generated always as identity primary key,
  bucket text not null,
  path text not null,
  reason text not null check (reason in ('row_deleted', 'path_replaced', 'upload_failed')),
  attempts int not null default 0,
  last_error text,
  not_before timestamptz not null default now(),
  created_at timestamptz not null default now(),
  done_at timestamptz,
  unique (bucket, path)
);
create index if not exists storage_cleanup_pending_idx
  on public.storage_cleanup_queue (not_before) where done_at is null;

alter table public.storage_cleanup_queue enable row level security;
revoke all on public.storage_cleanup_queue from anon, authenticated;

-- Which module permission controls each bucket (mirrors the storage policies).
create or replace function public.storage_bucket_permission(p_bucket text)
returns text language sql immutable set search_path = '' as $$
  select case p_bucket
    when 'project-media' then 'projects'
    when 'dashboard-media' then 'dashboard'
    when 'project-cost-attachments' then 'cost'
    when 'product-images' then 'warehouse_products'
    when 'employee-photos' then 'employees'
    when 'gov-documents' then 'government'
    when 'company-expense-receipts' then 'expenses'
  end;
$$;

create or replace function public.storage_path_in_use(p_bucket text, p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_bucket
    when 'project-media' then exists (select 1 from public.project_media where file_path = p_path)
    when 'dashboard-media' then exists (select 1 from public.dashboard_media where file_path = p_path)
    when 'project-cost-attachments' then exists (select 1 from public.project_cost_attachments where file_path = p_path)
    when 'product-images' then exists (select 1 from public.inventory_items where image_path = p_path)
    when 'employee-photos' then exists (select 1 from public.employees where photo_path = p_path)
    when 'gov-documents' then exists (select 1 from public.government_accounts where doc_path = p_path)
    when 'company-expense-receipts' then exists (select 1 from public.company_expenses where receipt_path = p_path)
    else true  -- unknown bucket: never treat as free to delete
  end;
$$;

-- Trigger: queue the old path when a row is deleted or its path changes.
-- TG_ARGV[0] = bucket, TG_ARGV[1] = path column.
create or replace function public.storage_enqueue_old_path()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old text := to_jsonb(old) ->> tg_argv[1];
  v_new text := case when tg_op = 'UPDATE' then to_jsonb(new) ->> tg_argv[1] end;
begin
  if v_old is not null and v_old <> '' and (tg_op = 'DELETE' or v_new is distinct from v_old) then
    insert into public.storage_cleanup_queue (bucket, path, reason)
    values (tg_argv[0], v_old, case when tg_op = 'DELETE' then 'row_deleted' else 'path_replaced' end)
    on conflict (bucket, path) do update
      set done_at = null, attempts = 0, last_error = null, not_before = now(), reason = excluded.reason;
  end if;
  return null;
end;
$$;

do $$
declare t record;
begin
  for t in select * from (values
    ('project_media', 'project-media', 'file_path'),
    ('dashboard_media', 'dashboard-media', 'file_path'),
    ('project_cost_attachments', 'project-cost-attachments', 'file_path'),
    ('inventory_items', 'product-images', 'image_path'),
    ('employees', 'employee-photos', 'photo_path'),
    ('government_accounts', 'gov-documents', 'doc_path'),
    ('company_expenses', 'company-expense-receipts', 'receipt_path')
  ) as v(tbl, bucket, col) loop
    execute format('drop trigger if exists storage_cleanup_on_change on public.%I', t.tbl);
    execute format(
      'create trigger storage_cleanup_on_change after delete or update of %I on public.%I
         for each row execute function public.storage_enqueue_old_path(%L, %L)',
      t.col, t.tbl, t.bucket, t.col);
  end loop;
end $$;

-- App: queue an orphan left by a failed save (only if nothing references it).
create or replace function public.storage_cleanup_enqueue(p_bucket text, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.storage_bucket_permission(p_bucket) is null
     or not public.has_permission(public.storage_bucket_permission(p_bucket)) then
    raise exception 'لا تملك صلاحية على هذه الملفات' using errcode = '42501';
  end if;
  if p_path is null or p_path = '' or public.storage_path_in_use(p_bucket, p_path) then return; end if;
  insert into public.storage_cleanup_queue (bucket, path, reason, not_before)
  values (p_bucket, p_path, 'upload_failed', now() + interval '2 minutes')
  on conflict (bucket, path) do nothing;
end;
$$;

-- App: claim due items for buckets the caller can manage. Items whose file is
-- referenced again are closed without deleting anything.
create or replace function public.storage_cleanup_claim(p_limit int default 20)
returns table (id bigint, bucket text, path text)
language plpgsql security definer set search_path = '' as $$
begin
  update public.storage_cleanup_queue q
     set done_at = now(), last_error = 'still referenced — kept'
   where q.done_at is null and public.storage_path_in_use(q.bucket, q.path);

  return query
  with due as (
    select q.id from public.storage_cleanup_queue q
    where q.done_at is null and q.not_before <= now() and q.attempts < 10
      and public.has_permission(public.storage_bucket_permission(q.bucket))
    order by q.not_before
    limit greatest(1, least(p_limit, 100))
    for update skip locked
  )
  update public.storage_cleanup_queue q
     set attempts = q.attempts + 1,
         not_before = now() + interval '5 minutes'  -- lease: another tab won't grab it meanwhile
    from due where q.id = due.id
  returning q.id, q.bucket, q.path;
end;
$$;

-- App: report the outcome. Failure backs off exponentially (max ~1 day).
create or replace function public.storage_cleanup_finish(p_id bigint, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.storage_cleanup_queue q
     set done_at = case when p_error is null then now() end,
         last_error = left(p_error, 500),
         not_before = case when p_error is null then q.not_before
                           else now() + least(interval '1 day', interval '1 minute' * power(2, q.attempts)) end
   where q.id = p_id
     and public.has_permission(public.storage_bucket_permission(q.bucket));
end;
$$;

-- Admin dry run: files in storage that no row references (nothing is deleted).
create or replace function public.storage_orphans_report()
returns table (bucket text, orphan_files bigint, orphan_bytes bigint, oldest timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('settings') then
    raise exception 'التقرير للمدير فقط' using errcode = '42501';
  end if;
  return query
  select o.bucket_id::text, count(*), coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint, min(o.created_at)
  from storage.objects o
  where public.storage_bucket_permission(o.bucket_id) is not null
    and not public.storage_path_in_use(o.bucket_id, o.name)
  group by o.bucket_id;
end;
$$;

revoke execute on function public.storage_path_in_use(text, text) from public, anon, authenticated;
revoke execute on function public.storage_enqueue_old_path() from public, anon, authenticated;
revoke execute on function public.storage_cleanup_enqueue(text, text) from public, anon;
revoke execute on function public.storage_cleanup_claim(int) from public, anon;
revoke execute on function public.storage_cleanup_finish(bigint, text) from public, anon;
revoke execute on function public.storage_orphans_report() from public, anon;
grant execute on function public.storage_cleanup_enqueue(text, text) to authenticated;
grant execute on function public.storage_cleanup_claim(int) to authenticated;
grant execute on function public.storage_cleanup_finish(bigint, text) to authenticated;
grant execute on function public.storage_orphans_report() to authenticated;
