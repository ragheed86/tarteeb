-- Company-wide expenses and bank reconciliation.
-- Partner tables are intentionally kept intact for historical data; the app hides their UI.

create table public.company_expenses (
  id uuid primary key default gen_random_uuid(),
  description text not null check (char_length(trim(description)) > 0),
  category text not null default 'other'
    check (category in ('software','hosting','equipment','office','marketing','payroll','legal','maintenance','other')),
  vendor text,
  amount numeric(12,2) not null check (amount > 0),
  vat_amount numeric(12,2) not null default 0 check (vat_amount >= 0 and vat_amount <= amount),
  expense_date date not null default current_date,
  payment_status text not null default 'paid' check (payment_status in ('paid','pending')),
  recurrence text not null default 'none' check (recurrence in ('none','monthly','yearly')),
  note text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_expense_budgets (
  id uuid primary key default gen_random_uuid(),
  month date not null unique check (month = date_trunc('month', month)::date),
  amount numeric(12,2) not null check (amount > 0),
  alert_percent smallint not null default 80 check (alert_percent between 1 and 100),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) > 0),
  bank_name text,
  last_four text check (last_four is null or last_four ~ '^[0-9]{4}$'),
  opening_balance numeric(14,2) not null default 0,
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.bank_accounts(id) on delete cascade,
  transaction_date date not null,
  description text not null check (char_length(trim(description)) > 0),
  reference text,
  external_id text,
  amount numeric(14,2) not null check (amount <> 0),
  status text not null default 'unmatched' check (status in ('unmatched','suggested','matched','excluded')),
  matched_expense_id uuid references public.company_expenses(id) on delete set null,
  matched_invoice_payment_id uuid references public.invoice_payments(id) on delete set null,
  confidence smallint check (confidence between 0 and 100),
  import_batch text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bank_transaction_single_match check (
    not (matched_expense_id is not null and matched_invoice_payment_id is not null)
  ),
  constraint bank_transaction_matched_target check (
    status <> 'matched' or matched_expense_id is not null or matched_invoice_payment_id is not null
  ),
  unique (account_id, external_id)
);

create index company_expenses_date_idx on public.company_expenses(expense_date desc);
create index company_expenses_category_idx on public.company_expenses(category);
create index company_expenses_status_idx on public.company_expenses(payment_status);
create index bank_transactions_account_date_idx on public.bank_transactions(account_id, transaction_date desc);
create index bank_transactions_status_idx on public.bank_transactions(status);
create index bank_transactions_reference_idx on public.bank_transactions(reference) where reference is not null;
create unique index bank_transactions_expense_match_idx
  on public.bank_transactions(matched_expense_id) where matched_expense_id is not null;
create unique index bank_transactions_payment_match_idx
  on public.bank_transactions(matched_invoice_payment_id) where matched_invoice_payment_id is not null;

create trigger company_expenses_set_updated_at
  before update on public.company_expenses
  for each row execute function public.set_updated_at();
create trigger company_expense_budgets_set_updated_at
  before update on public.company_expense_budgets
  for each row execute function public.set_updated_at();
create trigger bank_accounts_set_updated_at
  before update on public.bank_accounts
  for each row execute function public.set_updated_at();
create trigger bank_transactions_set_updated_at
  before update on public.bank_transactions
  for each row execute function public.set_updated_at();

alter table public.company_expenses enable row level security;
alter table public.company_expense_budgets enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.bank_transactions enable row level security;

create policy permission_select on public.company_expenses for select to authenticated
  using ((select public.has_permission('expenses')));
create policy permission_insert on public.company_expenses for insert to authenticated
  with check ((select public.has_permission('expenses')));
create policy permission_update on public.company_expenses for update to authenticated
  using ((select public.has_permission('expenses')))
  with check ((select public.has_permission('expenses')));
create policy permission_delete on public.company_expenses for delete to authenticated
  using ((select public.has_permission('expenses')));

create policy permission_select on public.company_expense_budgets for select to authenticated
  using ((select public.has_permission('expenses')));
create policy permission_insert on public.company_expense_budgets for insert to authenticated
  with check ((select public.has_permission('expenses')));
create policy permission_update on public.company_expense_budgets for update to authenticated
  using ((select public.has_permission('expenses')))
  with check ((select public.has_permission('expenses')));
create policy permission_delete on public.company_expense_budgets for delete to authenticated
  using ((select public.has_permission('expenses')));

create policy permission_select on public.bank_accounts for select to authenticated
  using ((select public.has_permission('bank_reconciliation')));
create policy permission_insert on public.bank_accounts for insert to authenticated
  with check ((select public.has_permission('bank_reconciliation')));
create policy permission_update on public.bank_accounts for update to authenticated
  using ((select public.has_permission('bank_reconciliation')))
  with check ((select public.has_permission('bank_reconciliation')));
create policy permission_delete on public.bank_accounts for delete to authenticated
  using ((select public.has_permission('bank_reconciliation')));

create policy permission_select on public.bank_transactions for select to authenticated
  using ((select public.has_permission('bank_reconciliation')));
create policy permission_insert on public.bank_transactions for insert to authenticated
  with check ((select public.has_permission('bank_reconciliation')));
create policy permission_update on public.bank_transactions for update to authenticated
  using ((select public.has_permission('bank_reconciliation')))
  with check ((select public.has_permission('bank_reconciliation')));
create policy permission_delete on public.bank_transactions for delete to authenticated
  using ((select public.has_permission('bank_reconciliation')));

grant select, insert, update, delete on public.company_expenses to authenticated;
grant select, insert, update, delete on public.company_expense_budgets to authenticated;
grant select, insert, update, delete on public.bank_accounts to authenticated;
grant select, insert, update, delete on public.bank_transactions to authenticated;

-- Users who previously had partner accounting receive the two replacement finance permissions.
update public.app_user_access
set permissions = (
  select array_agg(distinct permission)
  from unnest(permissions || array['expenses','bank_reconciliation']::text[]) as permission
)
where role in ('admin','accountant') or 'partners' = any(permissions);
