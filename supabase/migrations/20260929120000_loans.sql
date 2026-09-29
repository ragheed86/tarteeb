-- نظام تسديد القروض: القرض، جدول الأقساط، الدفعات، وربطها بالحركات البنكية.
-- السداد يُسجَّل مرة واحدة فقط في loan_payments ويُربط بحركة بنكية عبر
-- bank_transactions.matched_loan_payment_id — بلا ازدواجية مع مصاريف الشركة.

create table public.loans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) > 0),
  lender text,
  principal_amount numeric(14,2) not null check (principal_amount > 0),
  fees_amount numeric(14,2) not null default 0 check (fees_amount >= 0),
  start_date date not null default current_date,
  end_date date,
  installments_count smallint not null check (installments_count between 1 and 480),
  frequency text not null default 'monthly'
    check (frequency in ('monthly', 'quarterly', 'semiannual', 'yearly')),
  bank_account_id uuid references public.bank_accounts(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'closed', 'defaulted')),
  note text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loan_end_after_start check (end_date is null or end_date >= start_date)
);

create table public.loan_installments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id) on delete cascade,
  seq smallint not null check (seq > 0),
  due_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  principal_component numeric(14,2) not null default 0 check (principal_component >= 0),
  fee_component numeric(14,2) not null default 0 check (fee_component >= 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'partial', 'paid')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (loan_id, seq)
);

create table public.loan_payments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id) on delete cascade,
  installment_id uuid references public.loan_installments(id) on delete set null,
  amount numeric(14,2) not null check (amount > 0),
  paid_at date not null default current_date,
  method text not null default 'bank_transfer'
    check (method in ('bank_transfer', 'card', 'mada', 'cash', 'stc_pay', 'apple_pay', 'other')),
  reference text,
  note text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ربط الدفعة بحركة بنكية واحدة فقط، بنفس أسلوب مطابقة المصاريف والفواتير.
alter table public.bank_transactions
  add column if not exists matched_loan_payment_id uuid references public.loan_payments(id) on delete set null;

alter table public.bank_transactions drop constraint if exists bank_transaction_single_match;
alter table public.bank_transactions add constraint bank_transaction_single_match check (
  (case when matched_expense_id is not null then 1 else 0 end)
  + (case when matched_invoice_payment_id is not null then 1 else 0 end)
  + (case when matched_loan_payment_id is not null then 1 else 0 end) <= 1
);

alter table public.bank_transactions drop constraint if exists bank_transaction_matched_target;
alter table public.bank_transactions add constraint bank_transaction_matched_target check (
  status <> 'matched'
  or matched_expense_id is not null
  or matched_invoice_payment_id is not null
  or matched_loan_payment_id is not null
);

create index loans_status_idx on public.loans(status);
create index loans_start_idx on public.loans(start_date desc);
create index loan_installments_loan_idx on public.loan_installments(loan_id, seq);
create index loan_installments_due_idx on public.loan_installments(due_date) where status <> 'paid';
create index loan_payments_loan_idx on public.loan_payments(loan_id, paid_at desc);
create index loan_payments_installment_idx on public.loan_payments(installment_id) where installment_id is not null;
create unique index bank_transactions_loan_payment_match_idx
  on public.bank_transactions(matched_loan_payment_id) where matched_loan_payment_id is not null;

create trigger loans_set_updated_at
  before update on public.loans
  for each row execute function public.set_updated_at();
create trigger loan_installments_set_updated_at
  before update on public.loan_installments
  for each row execute function public.set_updated_at();
create trigger loan_payments_set_updated_at
  before update on public.loan_payments
  for each row execute function public.set_updated_at();

-- إعادة احتساب القسط والرصيد بعد كل دفعة (إضافة/تعديل/حذف).
create or replace function public.loan_recalc_installment(p_installment uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_paid numeric(14,2);
  v_amount numeric(14,2);
begin
  if p_installment is null then return; end if;
  select amount into v_amount from public.loan_installments where id = p_installment;
  if v_amount is null then return; end if;
  select coalesce(sum(amount), 0) into v_paid
    from public.loan_payments where installment_id = p_installment;
  update public.loan_installments
    set paid_amount = v_paid,
        status = case
          when v_paid <= 0 then 'pending'
          when v_paid + 0.009 >= v_amount then 'paid'
          else 'partial' end
    where id = p_installment;
end;
$$;

-- إقفال القرض تلقائياً عند سداد كل الأقساط، وإعادة فتحه إن تراجع السداد.
create or replace function public.loan_sync_status(p_loan uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_open int;
  v_status text;
begin
  if p_loan is null then return; end if;
  select status into v_status from public.loans where id = p_loan;
  if v_status is null or v_status = 'defaulted' then return; end if;
  select count(*) into v_open
    from public.loan_installments where loan_id = p_loan and status <> 'paid';
  if v_open = 0 and v_status <> 'closed' then
    update public.loans set status = 'closed' where id = p_loan;
  elsif v_open > 0 and v_status = 'closed' then
    update public.loans set status = 'active' where id = p_loan;
  end if;
end;
$$;

create or replace function public.loan_payments_after_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.loan_recalc_installment(old.installment_id);
    perform public.loan_sync_status(old.loan_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.loan_recalc_installment(new.installment_id);
    perform public.loan_sync_status(new.loan_id);
  end if;
  return null;
end;
$$;

create trigger loan_payments_recalc
  after insert or update or delete on public.loan_payments
  for each row execute function public.loan_payments_after_change();

alter table public.loans enable row level security;
alter table public.loan_installments enable row level security;
alter table public.loan_payments enable row level security;

create policy permission_select on public.loans for select to authenticated
  using ((select public.has_permission('loans')));
create policy permission_insert on public.loans for insert to authenticated
  with check ((select public.has_permission('loans')));
create policy permission_update on public.loans for update to authenticated
  using ((select public.has_permission('loans')))
  with check ((select public.has_permission('loans')));
create policy permission_delete on public.loans for delete to authenticated
  using ((select public.has_permission('loans')));

create policy permission_select on public.loan_installments for select to authenticated
  using ((select public.has_permission('loans')));
create policy permission_insert on public.loan_installments for insert to authenticated
  with check ((select public.has_permission('loans')));
create policy permission_update on public.loan_installments for update to authenticated
  using ((select public.has_permission('loans')))
  with check ((select public.has_permission('loans')));
create policy permission_delete on public.loan_installments for delete to authenticated
  using ((select public.has_permission('loans')));

create policy permission_select on public.loan_payments for select to authenticated
  using ((select public.has_permission('loans')));
create policy permission_insert on public.loan_payments for insert to authenticated
  with check ((select public.has_permission('loans')));
create policy permission_update on public.loan_payments for update to authenticated
  using ((select public.has_permission('loans')))
  with check ((select public.has_permission('loans')));
create policy permission_delete on public.loan_payments for delete to authenticated
  using ((select public.has_permission('loans')));

grant select, insert, update, delete on public.loans to authenticated;
grant select, insert, update, delete on public.loan_installments to authenticated;
grant select, insert, update, delete on public.loan_payments to authenticated;

-- المدير والمحاسب يحصلون على صلاحية القروض تلقائياً.
update public.app_user_access
set permissions = (
  select array_agg(distinct permission)
  from unnest(permissions || array['loans']::text[]) as permission
)
where role in ('admin', 'accountant');
