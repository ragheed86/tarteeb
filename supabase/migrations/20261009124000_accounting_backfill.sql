-- المحاسبة · ترحيل تاريخي كامل (Backfill) — يبني قيود كل السجلات الموجودة مسبقًا في
-- الفواتير/الدفعات/المصاريف/مسيّرات الرواتب المقفلة/القروض/سداد القروض، بنفس منطق
-- triggers الترحيل التلقائي في الملف السابق (مُكرَّر هنا عمدًا لأن الدوال تُستدعى مرة
-- واحدة فقط لكل صف تاريخي، لا عبر trigger). آمن للتشغيل أكثر من مرة: accounting_post()
-- idempotent بفضل القيد الفريد على (source_table, source_id, source_event).

-- ---------- invoices ----------
do $$
declare
  r public.invoices%rowtype;
  v_lines jsonb;
begin
  for r in select * from public.invoices where status <> 'draft' order by issue_at, created_at loop
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '1120', 'debit', r.total, 'credit', 0, 'client_id', r.client_id, 'project_id', r.project_id),
      jsonb_build_object('account_code', '4100', 'debit', 0, 'credit', r.subtotal, 'client_id', r.client_id, 'project_id', r.project_id)
    );
    if coalesce(r.vat_amount, 0) > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('account_code', '2120', 'debit', 0, 'credit', r.vat_amount, 'client_id', r.client_id)
      );
    end if;
    perform public.accounting_post(r.issue_at::date, 'فاتورة ' || coalesce(r.number, r.id::text), 'invoices', r.id, 'issue', v_lines, false);

    if r.status = 'refunded' then
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code', '1120', 'debit', 0, 'credit', r.total, 'client_id', r.client_id, 'project_id', r.project_id),
        jsonb_build_object('account_code', '4100', 'debit', r.subtotal, 'credit', 0, 'client_id', r.client_id, 'project_id', r.project_id)
      );
      if coalesce(r.vat_amount, 0) > 0 then
        v_lines := v_lines || jsonb_build_array(
          jsonb_build_object('account_code', '2120', 'debit', r.vat_amount, 'credit', 0, 'client_id', r.client_id)
        );
      end if;
      perform public.accounting_post(r.issue_at::date, 'استرجاع فاتورة ' || coalesce(r.number, r.id::text), 'invoices', r.id, 'refund', v_lines, false);
    end if;
  end loop;
end $$;

-- ---------- invoice_payments ----------
do $$
declare
  r public.invoice_payments%rowtype;
  v_client uuid;
  v_project uuid;
  v_fund text;
begin
  for r in select * from public.invoice_payments order by paid_at, created_at loop
    select client_id, project_id into v_client, v_project from public.invoices where id = r.invoice_id;
    v_fund := case when r.method = 'cash' then '1101' else '1103' end;
    perform public.accounting_post(
      r.paid_at::date, 'دفعة على فاتورة', 'invoice_payments', r.id, 'default',
      jsonb_build_array(
        jsonb_build_object('account_code', v_fund, 'debit', r.amount, 'credit', 0, 'client_id', v_client, 'project_id', v_project),
        jsonb_build_object('account_code', '1120', 'debit', 0, 'credit', r.amount, 'client_id', v_client, 'project_id', v_project)
      ),
      false
    );
  end loop;
end $$;

-- ---------- company_expenses ----------
do $$
declare
  r public.company_expenses%rowtype;
  v_net numeric(14,2);
  v_lines jsonb;
  v_fund text;
begin
  for r in select * from public.company_expenses order by expense_date, created_at loop
    v_net := r.amount - coalesce(r.vat_amount, 0);
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_code', public.accounting_expense_account_code(r.category),
        'debit', v_net, 'credit', 0,
        'project_id', r.project_id, 'employee_id', r.employee_id, 'supplier_id', r.supplier_id
      )
    );
    if coalesce(r.vat_amount, 0) > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('account_code', '1140', 'debit', r.vat_amount, 'credit', 0)
      );
    end if;
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_code', '2110', 'debit', 0, 'credit', r.amount, 'supplier_id', r.supplier_id, 'project_id', r.project_id)
    );
    perform public.accounting_post(r.expense_date, coalesce(r.description, 'مصروف شركة'), 'company_expenses', r.id, 'accrue', v_lines, false);

    if r.payment_status = 'paid' then
      v_fund := public.accounting_bank_account_code(r.account_id);
      perform public.accounting_post(
        r.expense_date, coalesce(r.description, 'سداد مصروف شركة'), 'company_expenses', r.id, 'pay',
        jsonb_build_array(
          jsonb_build_object('account_code', '2110', 'debit', r.amount, 'credit', 0, 'supplier_id', r.supplier_id, 'project_id', r.project_id),
          jsonb_build_object('account_code', v_fund, 'debit', 0, 'credit', r.amount)
        ),
        false
      );
    end if;
  end loop;
end $$;

-- ---------- payroll_runs (المُقفلة فقط) ----------
do $$
declare
  r public.payroll_runs%rowtype;
  v_gross numeric(14,2);
  v_employer_extra numeric(14,2);
  v_net numeric(14,2);
  v_gosi numeric(14,2);
  v_benefits numeric(14,2);
  v_withheld numeric(14,2);
begin
  for r in select * from public.payroll_runs where status = 'locked' order by period_month loop
    select
      coalesce(sum(gross_pay), 0),
      coalesce(sum(gosi_employer + insurance_monthly + govt_fees_monthly + eos_accrual + ticket_accrual), 0),
      coalesce(sum(net_pay), 0),
      coalesce(sum(gosi_employee + gosi_employer), 0),
      coalesce(sum(insurance_monthly + govt_fees_monthly + eos_accrual + ticket_accrual), 0),
      coalesce(sum(absence_deduction + advance_installment + other_deductions), 0)
    into v_gross, v_employer_extra, v_net, v_gosi, v_benefits, v_withheld
    from public.payroll_lines where run_id = r.id;

    perform public.accounting_post(
      r.period_month, 'مسيّر رواتب ' || to_char(r.period_month, 'YYYY-MM'), 'payroll_runs', r.id, 'lock',
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
  end loop;
end $$;

-- ---------- loans ----------
do $$
declare
  r public.loans%rowtype;
  v_fund text;
  v_lines jsonb;
begin
  for r in select * from public.loans order by start_date, created_at loop
    v_fund := public.accounting_bank_account_code(r.bank_account_id);
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', v_fund, 'debit', r.principal_amount, 'credit', 0, 'loan_id', r.id)
    );
    if coalesce(r.fees_amount, 0) > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('account_code', '5400', 'debit', r.fees_amount, 'credit', 0, 'loan_id', r.id)
      );
    end if;
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_code', '2210', 'debit', 0, 'credit', r.principal_amount + coalesce(r.fees_amount, 0), 'loan_id', r.id)
    );
    perform public.accounting_post(r.start_date, 'صرف قرض: ' || r.name, 'loans', r.id, 'disburse', v_lines, false);
  end loop;
end $$;

-- ---------- loan_payments ----------
do $$
declare
  r public.loan_payments%rowtype;
  v_bank uuid;
  v_fund text;
begin
  for r in select * from public.loan_payments order by paid_at, created_at loop
    select bank_account_id into v_bank from public.loans where id = r.loan_id;
    v_fund := public.accounting_bank_account_code(v_bank);
    perform public.accounting_post(
      r.paid_at, 'سداد قسط قرض', 'loan_payments', r.id, 'default',
      jsonb_build_array(
        jsonb_build_object('account_code', '2210', 'debit', r.amount, 'credit', 0, 'loan_id', r.loan_id),
        jsonb_build_object('account_code', v_fund, 'debit', 0, 'credit', r.amount, 'loan_id', r.loan_id)
      ),
      false
    );
  end loop;
end $$;
