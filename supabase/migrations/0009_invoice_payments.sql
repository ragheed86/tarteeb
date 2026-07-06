-- Invoice payments, due dates, and derived collection status.

alter table public.invoices add column if not exists due_at date;
alter table public.invoices add column if not exists paid_at timestamptz;

update public.invoices
set due_at = (issue_at::date + 14)
where due_at is null;

create table if not exists public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  method text not null default 'cash' check (method in ('cash', 'bank_transfer', 'card', 'mada', 'stc_pay', 'other')),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_invoice_payments_invoice on public.invoice_payments(invoice_id);
create index if not exists idx_invoice_payments_paid_at on public.invoice_payments(paid_at);

alter table public.invoice_payments enable row level security;

drop policy if exists permission_select on public.invoice_payments;
drop policy if exists permission_insert on public.invoice_payments;
drop policy if exists permission_update on public.invoice_payments;
drop policy if exists permission_delete on public.invoice_payments;

create policy permission_select on public.invoice_payments
  for select to authenticated
  using ((select public.has_permission('invoices')));

create policy permission_insert on public.invoice_payments
  for insert to authenticated
  with check ((select public.has_permission('invoices')));

create policy permission_update on public.invoice_payments
  for update to authenticated
  using ((select public.has_permission('invoices')))
  with check ((select public.has_permission('invoices')));

create policy permission_delete on public.invoice_payments
  for delete to authenticated
  using ((select public.has_permission('invoices')));

grant select, insert, update, delete on table public.invoice_payments to authenticated;

create or replace function public.recalculate_invoice_status(p_invoice_id uuid)
returns public.invoice_status
language plpgsql
security invoker
set search_path = ''
as $$
declare
  invoice_row public.invoices%rowtype;
  paid_total numeric(12,2);
  next_status public.invoice_status;
begin
  select * into invoice_row
  from public.invoices
  where id = p_invoice_id;

  if not found then
    return null;
  end if;

  select coalesce(sum(amount), 0)
  into paid_total
  from public.invoice_payments
  where invoice_id = p_invoice_id;

  if paid_total >= invoice_row.total and invoice_row.total > 0 then
    next_status := 'paid'::public.invoice_status;
  elsif paid_total > 0 then
    next_status := 'partial'::public.invoice_status;
  elsif invoice_row.status = 'draft'::public.invoice_status then
    next_status := 'draft'::public.invoice_status;
  elsif invoice_row.due_at is not null and invoice_row.due_at < current_date then
    next_status := 'overdue'::public.invoice_status;
  else
    next_status := 'unpaid'::public.invoice_status;
  end if;

  update public.invoices
  set
    status = next_status,
    paid_at = case when next_status = 'paid'::public.invoice_status then coalesce(paid_at, now()) else null end
  where id = p_invoice_id;

  return next_status;
end;
$$;

revoke execute on function public.recalculate_invoice_status(uuid) from public, anon;
grant execute on function public.recalculate_invoice_status(uuid) to authenticated;

create or replace function public.refresh_invoice_status_from_payment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.recalculate_invoice_status(coalesce(new.invoice_id, old.invoice_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_invoice_payments_refresh_status on public.invoice_payments;
create trigger trg_invoice_payments_refresh_status
  after insert or update or delete on public.invoice_payments
  for each row execute function public.refresh_invoice_status_from_payment();

create or replace function public.refresh_invoice_status_from_invoice()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.status = 'draft'::public.invoice_status then
    return new;
  end if;

  perform public.recalculate_invoice_status(new.id);
  return new;
end;
$$;

drop trigger if exists trg_invoices_refresh_status on public.invoices;
create trigger trg_invoices_refresh_status
  after update of total, due_at, status on public.invoices
  for each row
  when (old.total is distinct from new.total or old.due_at is distinct from new.due_at or old.status is distinct from new.status)
  execute function public.refresh_invoice_status_from_invoice();

insert into public.invoice_payments (invoice_id, amount, paid_at, method, note)
select id, total, coalesce(paid_at, issue_at), 'other', 'دفعة افتتاحية لفاتورة كانت مدفوعة قبل إضافة نظام الدفعات'
from public.invoices
where status = 'paid'::public.invoice_status
  and total > 0
  and not exists (
    select 1 from public.invoice_payments p where p.invoice_id = invoices.id
  );

select public.recalculate_invoice_status(id)
from public.invoices
where status <> 'draft'::public.invoice_status;

create or replace view public.invoice_payment_summaries
with (security_invoker = true)
as
select
  i.id as invoice_id,
  i.total,
  coalesce(sum(p.amount), 0)::numeric(12,2) as paid_amount,
  greatest(i.total - coalesce(sum(p.amount), 0), 0)::numeric(12,2) as remaining_amount,
  max(p.paid_at) as last_payment_at,
  count(p.id)::int as payment_count
from public.invoices i
left join public.invoice_payments p on p.invoice_id = i.id
group by i.id, i.total;

grant select on public.invoice_payment_summaries to authenticated;
