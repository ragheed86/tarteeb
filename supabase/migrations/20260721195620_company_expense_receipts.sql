-- Private invoice/receipt attachments for company expenses.
alter table public.company_expenses
  add column if not exists receipt_path text,
  add column if not exists receipt_name text,
  add column if not exists receipt_type text,
  add column if not exists receipt_size bigint check (receipt_size is null or receipt_size >= 0);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-expense-receipts',
  'company-expense-receipts',
  false,
  6291456,
  array['image/*', 'application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists company_expense_receipts_select on storage.objects;
create policy company_expense_receipts_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'company-expense-receipts'
    and (select public.has_permission('expenses'))
  );

drop policy if exists company_expense_receipts_insert on storage.objects;
create policy company_expense_receipts_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'company-expense-receipts'
    and (select public.has_permission('expenses'))
  );

drop policy if exists company_expense_receipts_update on storage.objects;
create policy company_expense_receipts_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'company-expense-receipts'
    and (select public.has_permission('expenses'))
  )
  with check (
    bucket_id = 'company-expense-receipts'
    and (select public.has_permission('expenses'))
  );

drop policy if exists company_expense_receipts_delete on storage.objects;
create policy company_expense_receipts_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'company-expense-receipts'
    and (select public.has_permission('expenses'))
  );
