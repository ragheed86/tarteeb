-- ربط المطابقة البنكية بدفعات القروض.
-- عمود matched_loan_payment_id وقيوده موجودة في القاعدة مسبقاً؛ هذه الهجرة تكمل ما ينقصه:
-- تغطية سجل المراجعة للعمود الجديد، حتى لا تمر مطابقة قرض دون أثر.

alter table public.bank_transaction_audit
  add column if not exists old_loan_payment_id uuid,
  add column if not exists new_loan_payment_id uuid;

create or replace function public.log_bank_transaction_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'import';
  elsif old.status is distinct from new.status
     or old.matched_expense_id is distinct from new.matched_expense_id
     or old.matched_invoice_payment_id is distinct from new.matched_invoice_payment_id
     or old.matched_loan_payment_id is distinct from new.matched_loan_payment_id then
    if new.status = 'excluded' then
      v_action := 'exclude';
    elsif new.status = 'matched' then
      v_action := case when new.confidence is null then 'manual_match' else 'match' end;
    elsif new.status = 'unmatched' and old.status in ('matched', 'excluded') then
      v_action := 'reopen';
    else
      v_action := 'edit';
    end if;
  else
    return new;
  end if;

  insert into public.bank_transaction_audit (
    transaction_id, account_id, transaction_date, action,
    old_status, new_status, old_expense_id, new_expense_id,
    old_payment_id, new_payment_id, old_loan_payment_id, new_loan_payment_id, confidence
  ) values (
    new.id, new.account_id, new.transaction_date, v_action,
    case when tg_op = 'INSERT' then null else old.status end,
    new.status,
    case when tg_op = 'INSERT' then null else old.matched_expense_id end,
    new.matched_expense_id,
    case when tg_op = 'INSERT' then null else old.matched_invoice_payment_id end,
    new.matched_invoice_payment_id,
    case when tg_op = 'INSERT' then null else old.matched_loan_payment_id end,
    new.matched_loan_payment_id,
    new.confidence
  );
  return new;
end;
$$;

revoke execute on function public.log_bank_transaction_change() from public, anon, authenticated;
