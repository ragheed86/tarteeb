-- إغلاق تسريب صافي الأجر عبر رسائل حارس المطابقة البنكية.
-- المحاسب يملك صلاحية المطابقة البنكية ويرى payroll_line_id في جدول المطابقات،
-- فكان يقدر يجرّب مطابقة بمبلغ ضخم ويقرأ «المتبقي منه» من رسالة الخطأ.
-- الحارس يعمل بصلاحية المالك فلا تحميه سياسات payroll_lines.

create or replace function public.bank_match_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.bank_transactions%rowtype;
  v_target_key text;
  v_target_amount numeric(14,2);
  v_used_tx numeric(14,2);
  v_used_target numeric(14,2);
  v_run_status text;
begin
  if tg_op = 'DELETE' then
    select * into v_tx from public.bank_transactions where id = old.bank_transaction_id;
    if found and public.bank_period_is_closed(v_tx.account_id, v_tx.transaction_date) then
      raise exception 'الشهر % مقفل — لا يمكن فك المطابقة أو حذف مصدرها', to_char(v_tx.transaction_date, 'YYYY-MM');
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and new.bank_transaction_id <> old.bank_transaction_id then
    raise exception 'لا يمكن نقل المطابقة لحركة أخرى — احذفها وأنشئ مطابقة جديدة';
  end if;

  select * into v_tx from public.bank_transactions where id = new.bank_transaction_id for update;
  if not found then raise exception 'الحركة البنكية غير موجودة'; end if;
  if v_tx.status = 'excluded' then raise exception 'الحركة مستبعدة — أعدها للمراجعة أولاً'; end if;
  if public.bank_period_is_closed(v_tx.account_id, v_tx.transaction_date) then
    raise exception 'الشهر % مقفل لهذا الحساب', to_char(v_tx.transaction_date, 'YYYY-MM');
  end if;

  -- الاتجاه: الإيداع يُطابق دفعات الفواتير، والسحب يُطابق المصاريف/القروض/الرواتب
  if v_tx.amount > 0 and new.invoice_payment_id is null then
    raise exception 'الحركة الواردة تُطابق مع دفعات الفواتير فقط';
  end if;
  if v_tx.amount < 0 and new.invoice_payment_id is not null then
    raise exception 'الحركة الصادرة لا تُطابق مع دفعة فاتورة';
  end if;

  if new.expense_id is not null then
    v_target_key := 'expense:' || new.expense_id;
    select amount into v_target_amount from public.company_expenses where id = new.expense_id;
  elsif new.invoice_payment_id is not null then
    v_target_key := 'payment:' || new.invoice_payment_id;
    select amount into v_target_amount from public.invoice_payments where id = new.invoice_payment_id;
  elsif new.loan_payment_id is not null then
    v_target_key := 'loan:' || new.loan_payment_id;
    select amount into v_target_amount from public.loan_payments where id = new.loan_payment_id;
  else
    -- بند الراتب لا يطابقه إلا من يملك صلاحية الرواتب: رسائل الحارس تكشف
    -- صافي الأجر المتبقي، فبدون هذا الفحص يستخرجه المحاسب بتجربة المبالغ.
    if not public.has_permission('payroll') then
      raise exception 'مطابقة الرواتب تتطلب صلاحية الرواتب';
    end if;
    v_target_key := 'payroll:' || new.payroll_line_id;
    select pl.net_pay, pr.status into v_target_amount, v_run_status
    from public.payroll_lines pl join public.payroll_runs pr on pr.id = pl.run_id
    where pl.id = new.payroll_line_id;
    if v_run_status = 'draft' then raise exception 'مسيّر الرواتب ما زال مسودة — اعتمده أولاً'; end if;
  end if;
  if v_target_amount is null then raise exception 'البند المراد مطابقته غير موجود'; end if;

  -- قفل على البند نفسه لمنع مطابقتين متزامنتين تتجاوزان قيمته
  perform pg_advisory_xact_lock(hashtext(v_target_key));

  select coalesce(sum(amount), 0) into v_used_tx
  from public.bank_reconciliation_matches
  where bank_transaction_id = new.bank_transaction_id and id <> new.id;
  if v_used_tx + new.amount > abs(v_tx.amount) + 0.005 then
    raise exception 'مجموع المطابقة (%) يتجاوز قيمة الحركة (%)', v_used_tx + new.amount, abs(v_tx.amount);
  end if;

  select coalesce(sum(amount), 0) into v_used_target
  from public.bank_reconciliation_matches m
  where m.id <> new.id and (
    (new.expense_id is not null and m.expense_id = new.expense_id)
    or (new.invoice_payment_id is not null and m.invoice_payment_id = new.invoice_payment_id)
    or (new.loan_payment_id is not null and m.loan_payment_id = new.loan_payment_id)
    or (new.payroll_line_id is not null and m.payroll_line_id = new.payroll_line_id)
  );
  if v_used_target + new.amount > v_target_amount + 0.005 then
    raise exception 'هذا البند مطابق مسبقاً (المتبقي منه %)', greatest(v_target_amount - v_used_target, 0);
  end if;
  return new;
end;
$$;
