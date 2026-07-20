-- Cover ownership foreign keys reported by the Supabase performance advisor.
create index company_expenses_created_by_idx on public.company_expenses(created_by);
create index company_expense_budgets_created_by_idx on public.company_expense_budgets(created_by);
create index bank_accounts_created_by_idx on public.bank_accounts(created_by);
create index bank_transactions_created_by_idx on public.bank_transactions(created_by);
