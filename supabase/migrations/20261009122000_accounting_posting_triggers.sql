-- المحاسبة · قواعد الترحيل التلقائي لكل مصدر عملياتي (فواتير/دفعات/مصاريف/رواتب/قروض).
-- كل دالة trigger أدناه security definer داخلية فقط (ممنوعة من authenticated) وتبني
-- سطور القيد ثم تستدعي public.accounting_post() المعرّفة في الملف السابق.

create or replace function public.accounting_expense_account_code(p_category text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_category
    when 'software'    then '5310'
    when 'hosting'      then '5320'
    when 'equipment'    then '5330'
    when 'office'       then '5340'
    when 'marketing'    then '5350'
    when 'payroll'      then '5360'
    when 'legal'        then '5370'
    when 'maintenance'  then '5380'
    else '5390'
  end;
$$;

create or replace function public.accounting_bank_account_code(p_bank_account_id uuid)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select code from public.chart_of_accounts where linked_bank_account_id = p_bank_account_id),
    '1103'
  );
$$;

-- ---------- invoices: issue + refund ----------
create or replace function public.accounting_post_invoice()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lines jsonb;
begin
  if new.status <> 'draft' and (tg_op = 'INSERT' or old.status = 'draft') then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '1120', 'debit', new.total, 'credit', 0, 'client_id', new.client_id, 'project_id', new.project_id),
      jsonb_build_object('account_code', '4100', 'debit', 0, 'credit', new.subtotal, 'client_id', new.client_id, 'project_id', new.project_id)
    );
    if coalesce(new.vat_amount, 0) > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('account_code', '2120', 'debit', 0, 'credit', new.vat_amount, 'client_id', new.client_id)
      );
    end if;
    perform public.accounting_post(
      new.issue_at::date, 'فاتورة ' || coalesce(new.number, new.id::text),
      'invoices', new.id, 'issue', v_lines, false
    );
  end if;

  if new.status = 'refunded' and (tg_op = 'INSERT' or old.status is distinct from 'refunded') then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '1120', 'debit', 0, 'credit', new.total, 'client_id', new.client_id, 'project_id', new.project_id),
      jsonb_build_object('account_code', '4100', 'debit', new.subtotal, 'credit', 0, 'client_id', new.client_id, 'project_id', new.project_id)
    );
    if coalesce(new.vat_amount, 0) > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('account_code', '2120', 'debit', new.vat_amount, 'credit', 0, 'client_id', new.client_id)
      );
    end if;
    perform public.accounting_post(
      current_date, 'استرجاع فاتورة ' || coalesce(new.number, new.id::text),
      'invoices', new.id, 'refund', v_lines, false
    );
  end if;

  return new;
end;
$$;

revoke execute on function public.accounting_post_invoice() from public, anon, authenticated;

create trigger invoices_post_accounting
  after insert or update of status on public.invoices
  for each row execute function public.accounting_post_invoice();

-- ---------- invoice_payments: دفعة تُستلم ----------
create or replace function public.accounting_post_invoice_payment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client_id uuid;
  v_project_id uuid;
  v_fund_code text;
begin
  select client_id, project_id into v_client_id, v_project_id from public.invoices where id = new.invoice_id;
  v_fund_code := case when new.method = 'cash' then '1101' else '1103' end;

  perform public.accounting_post(
    new.paid_at::date, 'دفعة على فاتورة',
    'invoice_payments', new.id, 'default',
    jsonb_build_array(
      jsonb_build_object('account_code', v_fund_code, 'debit', new.amount, 'credit', 0, 'client_id', v_client_id, 'project_id', v_project_id),
      jsonb_build_object('account_code', '1120', 'debit', 0, 'credit', new.amount, 'client_id', v_client_id, 'project_id', v_project_id)
    ),
    false
  );
  return new;
end;
$$;

revoke execute on function public.accounting_post_invoice_payment() from public, anon, authenticated;

create trigger invoice_payments_post_accounting
  after insert on public.invoice_payments
  for each row execute function public.accounting_post_invoice_payment();

-- ---------- company_expenses: استحقاق ثم سداد (نموذج محاسبة الاستحقاق) ----------
create or replace function public.accounting_post_expense_accrue()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_net numeric(14,2) := new.amount - coalesce(new.vat_amount, 0);
  v_lines jsonb;
begin
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_code', public.accounting_expense_account_code(new.category),
      'debit', v_net, 'credit', 0,
      'project_id', new.project_id, 'employee_id', new.employee_id, 'supplier_id', new.supplier_id
    )
  );
  if coalesce(new.vat_amount, 0) > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_code', '1140', 'debit', new.vat_amount, 'credit', 0)
    );
  end if;
  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('account_code', '2110', 'debit', 0, 'credit', new.amount, 'supplier_id', new.supplier_id, 'project_id', new.project_id)
  );

  perform public.accounting_post(
    new.expense_date, coalesce(new.description, 'مصروف شركة'),
    'company_expenses', new.id, 'accrue', v_lines, false
  );
  return new;
end;
$$;

revoke execute on function public.accounting_post_expense_accrue() from public, anon, authenticated;

create trigger company_expenses_post_accrue
  after insert on public.company_expenses
  for each row execute function public.accounting_post_expense_accrue();

create or replace function public.accounting_post_expense_pay()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fund_code text;
begin
  if new.payment_status = 'paid' and (tg_op = 'INSERT' or old.payment_status is distinct from 'paid') then
    v_fund_code := public.accounting_bank_account_code(new.account_id);

    perform public.accounting_post(
      new.expense_date, coalesce(new.description, 'سداد مصروف شركة'),
      'company_expenses', new.id, 'pay',
      jsonb_build_array(
        jsonb_build_object('account_code', '2110', 'debit', new.amount, 'credit', 0, 'supplier_id', new.supplier_id, 'project_id', new.project_id),
        jsonb_build_object('account_code', v_fund_code, 'debit', 0, 'credit', new.amount)
      ),
      false
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.accounting_post_expense_pay() from public, anon, authenticated;

create trigger company_expenses_post_pay
  after insert or update of payment_status on public.company_expenses
  for each row execute function public.accounting_post_expense_pay();

-- ---------- payroll_runs: قفل المسيّر (محاسبة استحقاق كاملة تضمن توازن القيد) ----------
create or replace function public.accounting_post_payroll_lock()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gross numeric(14,2);
  v_employer_extra numeric(14,2);
  v_net numeric(14,2);
  v_gosi numeric(14,2);
  v_benefits numeric(14,2);
  v_withheld numeric(14,2);
begin
  if new.status = 'locked' and old.status is distinct from 'locked' then
    select
      coalesce(sum(gross_pay), 0),
      coalesce(sum(gosi_employer + insurance_monthly + govt_fees_monthly + eos_accrual + ticket_accrual), 0),
      coalesce(sum(net_pay), 0),
      coalesce(sum(gosi_employee + gosi_employer), 0),
      coalesce(sum(insurance_monthly + govt_fees_monthly + eos_accrual + ticket_accrual), 0),
      coalesce(sum(absence_deduction + advance_installment + other_deductions), 0)
    into v_gross, v_employer_extra, v_net, v_gosi, v_benefits, v_withheld
    from public.payroll_lines where run_id = new.id;

    perform public.accounting_post(
      new.period_month, 'مسيّر رواتب ' || to_char(new.period_month, 'YYYY-MM'),
      'payroll_runs', new.id, 'lock',
      jsonb_build_array(
        jsonb_build_object('account_code', '5200', 'debit', v_gross, 'credit', 0),
        jsonb_build_object('account_code', '5210', 'debit', v_employer_extra, 'credit', 0),
        jsonb_build_object('account_code', '2130', 'debit', 0, 'credit', v_net),
        jsonb_build_object('account_code', '2140', 'debit', 0, 'credit', v_gosi),
        jsonb_build_object('account_code', '2150', 'debit', 0, 'credit', v_benefits),
        jsonb_build_object('account_code', '2160', 'debit', 0, 'credit', v_withheld)
      ),
      false
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.accounting_post_payroll_lock() from public, anon, authenticated;

create trigger payroll_runs_post_lock
  after update of status on public.payroll_runs
  for each row execute function public.accounting_post_payroll_lock();

-- ---------- loans: صرف القرض ----------
create or replace function public.accounting_post_loan_disburse()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fund_code text := public.accounting_bank_account_code(new.bank_account_id);
  v_lines jsonb;
begin
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', v_fund_code, 'debit', new.principal_amount, 'credit', 0, 'loan_id', new.id)
  );
  if coalesce(new.fees_amount, 0) > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_code', '5400', 'debit', new.fees_amount, 'credit', 0, 'loan_id', new.id)
    );
  end if;
  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('account_code', '2210', 'debit', 0, 'credit', new.principal_amount + coalesce(new.fees_amount, 0), 'loan_id', new.id)
  );

  perform public.accounting_post(
    new.start_date, 'صرف قرض: ' || new.name,
    'loans', new.id, 'disburse', v_lines, false
  );
  return new;
end;
$$;

revoke execute on function public.accounting_post_loan_disburse() from public, anon, authenticated;

create trigger loans_post_disburse
  after insert on public.loans
  for each row execute function public.accounting_post_loan_disburse();

-- ---------- loan_payments: سداد قسط (كامل القيمة يُخفّض أصل القرض — لا فصل فائدة في V1) ----------
create or replace function public.accounting_post_loan_payment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bank_account_id uuid;
  v_fund_code text;
begin
  select bank_account_id into v_bank_account_id from public.loans where id = new.loan_id;
  v_fund_code := public.accounting_bank_account_code(v_bank_account_id);

  perform public.accounting_post(
    new.paid_at, 'سداد قسط قرض',
    'loan_payments', new.id, 'default',
    jsonb_build_array(
      jsonb_build_object('account_code', '2210', 'debit', new.amount, 'credit', 0, 'loan_id', new.loan_id),
      jsonb_build_object('account_code', v_fund_code, 'debit', 0, 'credit', new.amount, 'loan_id', new.loan_id)
    ),
    false
  );
  return new;
end;
$$;

revoke execute on function public.accounting_post_loan_payment() from public, anon, authenticated;

create trigger loan_payments_post_accounting
  after insert on public.loan_payments
  for each row execute function public.accounting_post_loan_payment();
