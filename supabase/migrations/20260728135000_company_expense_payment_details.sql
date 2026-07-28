-- Track who paid each company expense and by which payment method.
alter table public.company_expenses
  add column if not exists paid_by text,
  add column if not exists payment_method text;

