-- المطابقة البنكية v2
-- 1) جدول توزيع المطابقات: الحركة الواحدة تُطابق مع بند أو أكثر (فاتورة/مصروف/قرض/راتب)
--    بمبالغ جزئية ← حالة «مطابقة جزئياً».
-- 2) الحالة مشتقّة دائماً من مجموع المطابقات (لا يمكن كتابة «مطابق» يدوياً بلا مصدر).
-- 3) منع المطابقة المزدوجة: مجموع ما يُطابق على الحركة ≤ قيمتها، ومجموع ما يُطابق على البند ≤ قيمته.
-- 4) كشف المكررات عند الاستيراد (duplicate_of).
-- 5) الإقفال الشهري لكل حساب مع تجميد الحركات والمطابقات داخل الشهر المقفل.
-- 6) سجل مراجعة غير قابل للتعديل لكل عملية.

-- ملاحظة: الفرع feat/manual-bank-matching (غير مدموج) طبّق على الإنتاج جدولي reconciliation_periods
-- و bank_transaction_audit ومشغّلاتهما بنموذج «ربط واحد لكل حركة». كانت فارغة وغير مستخدمة من الواجهة،
-- فتُستبدل هنا بالنموذج الجديد (مطابقات متعددة/جزئية + إقفال عبر دوال فقط + سجل لا يُحذف).
drop trigger if exists bank_transactions_guard_closed_period on public.bank_transactions;
drop trigger if exists bank_transactions_audit on public.bank_transactions;
drop function if exists public.guard_closed_reconciliation_period();
drop function if exists public.log_bank_transaction_change();
drop function if exists public.close_reconciliation_period(uuid, date, numeric, text);
drop function if exists public.reopen_reconciliation_period(uuid, date);
drop table if exists public.bank_transaction_audit;
drop table if exists public.reconciliation_periods;

-- ---------- جدول المطابقات ----------
create table public.bank_reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  bank_transaction_id uuid not null references public.bank_transactions(id) on delete cascade,
  expense_id uuid references public.company_expenses(id) on delete cascade,
  invoice_payment_id uuid references public.invoice_payments(id) on delete cascade,
  loan_payment_id uuid references public.loan_payments(id) on delete cascade,
  payroll_line_id uuid references public.payroll_lines(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  method text not null default 'manual' check (method in ('auto', 'manual', 'created')),
  confidence smallint check (confidence between 0 and 100),
  note text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint bank_match_single_target check (
    (expense_id is not null)::int + (invoice_payment_id is not null)::int
    + (loan_payment_id is not null)::int + (payroll_line_id is not null)::int = 1
  )
);
create unique index bank_matches_tx_expense_uq on public.bank_reconciliation_matches(bank_transaction_id, expense_id) where expense_id is not null;
create unique index bank_matches_tx_payment_uq on public.bank_reconciliation_matches(bank_transaction_id, invoice_payment_id) where invoice_payment_id is not null;
create unique index bank_matches_tx_loan_uq on public.bank_reconciliation_matches(bank_transaction_id, loan_payment_id) where loan_payment_id is not null;
create unique index bank_matches_tx_payroll_uq on public.bank_reconciliation_matches(bank_transaction_id, payroll_line_id) where payroll_line_id is not null;
create index bank_matches_tx_idx on public.bank_reconciliation_matches(bank_transaction_id);
create index bank_matches_expense_idx on public.bank_reconciliation_matches(expense_id) where expense_id is not null;
create index bank_matches_payment_idx on public.bank_reconciliation_matches(invoice_payment_id) where invoice_payment_id is not null;
create index bank_matches_loan_idx on public.bank_reconciliation_matches(loan_payment_id) where loan_payment_id is not null;
create index bank_matches_payroll_idx on public.bank_reconciliation_matches(payroll_line_id) where payroll_line_id is not null;
create index bank_matches_created_by_idx on public.bank_reconciliation_matches(created_by);

-- ---------- الإقفال الشهري ----------
create table public.bank_reconciliation_periods (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.bank_accounts(id) on delete cascade,
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  status text not null default 'closed' check (status in ('closed', 'reopened')),
  statement_closing_balance numeric(14,2) not null,
  computed_balance numeric(14,2) not null,
  difference numeric(14,2) not null default 0,
  snapshot jsonb not null default '{}'::jsonb,
  note text,
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  reopened_by uuid references auth.users(id) on delete set null,
  reopened_at timestamptz,
  reopen_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, period_month)
);
create index bank_periods_closed_by_idx on public.bank_reconciliation_periods(closed_by);
create index bank_periods_reopened_by_idx on public.bank_reconciliation_periods(reopened_by);
create trigger bank_reconciliation_periods_set_updated_at
  before update on public.bank_reconciliation_periods
  for each row execute function public.set_updated_at();

-- ---------- سجل المراجعة ----------
create table public.bank_reconciliation_audit (
  id bigint generated always as identity primary key,
  -- بلا مفاتيح أجنبية عمداً: السجل يبقى حتى لو حُذف الحساب أو الحركة
  account_id uuid,
  bank_transaction_id uuid,
  period_month date,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  actor uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index bank_audit_account_idx on public.bank_reconciliation_audit(account_id, created_at desc);
create index bank_audit_tx_idx on public.bank_reconciliation_audit(bank_transaction_id) where bank_transaction_id is not null;
create index bank_audit_actor_idx on public.bank_reconciliation_audit(actor);

-- ---------- أعمدة الحركات ----------
alter table public.bank_transactions
  add column if not exists matched_amount numeric(14,2) not null default 0,
  add column if not exists duplicate_of uuid references public.bank_transactions(id) on delete set null,
  add column if not exists exclude_reason text;
create index if not exists bank_transactions_duplicate_idx on public.bank_transactions(duplicate_of) where duplicate_of is not null;

-- نقل أي مطابقات قديمة (عمود واحد لكل نوع) إلى جدول المطابقات
insert into public.bank_reconciliation_matches (bank_transaction_id, expense_id, invoice_payment_id, loan_payment_id, amount, method, confidence, created_by, created_at)
select id, matched_expense_id, matched_invoice_payment_id, matched_loan_payment_id, abs(amount), 'manual', confidence, created_by, updated_at
from public.bank_transactions
where matched_expense_id is not null or matched_invoice_payment_id is not null or matched_loan_payment_id is not null;

alter table public.bank_transactions drop constraint if exists bank_transaction_single_match;
alter table public.bank_transactions drop constraint if exists bank_transaction_matched_target;
alter table public.bank_transactions drop constraint if exists bank_transactions_status_check;
update public.bank_transactions set status = 'unmatched' where status = 'suggested';
alter table public.bank_transactions drop column if exists matched_expense_id;
alter table public.bank_transactions drop column if exists matched_invoice_payment_id;
alter table public.bank_transactions drop column if exists matched_loan_payment_id;
alter table public.bank_transactions add constraint bank_transactions_status_check
  check (status in ('unmatched', 'partially_matched', 'matched', 'excluded'));

-- ---------- دوال مساعدة ----------
create or replace function public.bank_period_is_closed(p_account uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bank_reconciliation_periods p
    where p.account_id = p_account
      and p.period_month = date_trunc('month', p_date)::date
      and p.status = 'closed'
  );
$$;
revoke execute on function public.bank_period_is_closed(uuid, date) from public, anon;
grant execute on function public.bank_period_is_closed(uuid, date) to authenticated;

create or replace function public.bank_audit(p_account uuid, p_tx uuid, p_month date, p_action text, p_details jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.bank_reconciliation_audit (account_id, bank_transaction_id, period_month, action, details)
  values (p_account, p_tx, p_month, p_action, coalesce(p_details, '{}'::jsonb));
$$;
revoke execute on function public.bank_audit(uuid, uuid, date, text, jsonb) from public, anon, authenticated;

-- ---------- حركات البنك: حالة مشتقة + تجميد الشهر المقفل + كشف المكرر ----------
create or replace function public.bank_transaction_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_matched numeric(14,2);
begin
  if tg_op = 'DELETE' then
    if public.bank_period_is_closed(old.account_id, old.transaction_date) then
      raise exception 'لا يمكن حذف حركة ضمن شهر مقفل (%)', to_char(old.transaction_date, 'YYYY-MM');
    end if;
    return old;
  end if;

  if public.bank_period_is_closed(new.account_id, new.transaction_date)
     or (tg_op = 'UPDATE' and public.bank_period_is_closed(old.account_id, old.transaction_date)) then
    if tg_op = 'INSERT' then
      raise exception 'الشهر % مقفل لهذا الحساب ولا يقبل حركات جديدة', to_char(new.transaction_date, 'YYYY-MM');
    end if;
    if (new.status, new.amount, new.transaction_date, new.account_id, new.description, new.duplicate_of, new.exclude_reason)
       is distinct from (old.status, old.amount, old.transaction_date, old.account_id, old.description, old.duplicate_of, old.exclude_reason) then
      raise exception 'الشهر % مقفل — أعد فتحه أولاً لتعديل الحركة', to_char(old.transaction_date, 'YYYY-MM');
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.matched_amount := 0;
    if new.status <> 'excluded' then new.status := 'unmatched'; end if;
    -- مكرر محتمل: نفس الحساب والمبلغ، و(نفس المرجع) أو (نفس التاريخ والوصف والمرجع)، بمعرّف خارجي مختلف
    if new.duplicate_of is null then
      select t.id into new.duplicate_of
      from public.bank_transactions t
      where t.account_id = new.account_id
        and t.amount = new.amount
        and t.external_id is distinct from new.external_id
        and (
          (nullif(trim(new.reference), '') is not null and trim(t.reference) = trim(new.reference))
          or (t.transaction_date = new.transaction_date
              and lower(trim(t.description)) = lower(trim(new.description))
              and coalesce(trim(t.reference), '') = coalesce(trim(new.reference), ''))
        )
      order by t.created_at
      limit 1;
    end if;
    return new;
  end if;

  -- UPDATE: الحالة تُشتق من المطابقات دائماً
  select coalesce(sum(m.amount), 0) into v_matched
  from public.bank_reconciliation_matches m where m.bank_transaction_id = new.id;
  new.matched_amount := v_matched;

  if new.status = 'excluded' then
    if v_matched > 0 then
      raise exception 'فك المطابقات أولاً قبل استبعاد الحركة';
    end if;
  elsif v_matched = 0 then
    new.status := 'unmatched';
  elsif v_matched >= abs(new.amount) - 0.005 then
    new.status := 'matched';
  else
    new.status := 'partially_matched';
  end if;
  if new.status <> 'excluded' then new.exclude_reason := null; end if;
  if new.amount is distinct from old.amount and v_matched > abs(new.amount) + 0.005 then
    raise exception 'المبلغ الجديد أقل من المُطابق على الحركة';
  end if;
  return new;
end;
$$;

create or replace function public.bank_transaction_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.bank_audit(new.account_id, new.id, date_trunc('month', new.transaction_date)::date, 'import',
      jsonb_build_object('amount', new.amount, 'date', new.transaction_date, 'description', new.description,
                         'reference', new.reference, 'batch', new.import_batch, 'duplicate_of', new.duplicate_of));
  elsif tg_op = 'UPDATE' then
    if new.status = 'excluded' and old.status <> 'excluded' then
      perform public.bank_audit(new.account_id, new.id, date_trunc('month', new.transaction_date)::date, 'exclude',
        jsonb_build_object('reason', new.exclude_reason, 'amount', new.amount));
    elsif old.status = 'excluded' and new.status <> 'excluded' then
      perform public.bank_audit(new.account_id, new.id, date_trunc('month', new.transaction_date)::date, 'restore',
        jsonb_build_object('amount', new.amount));
    end if;
    if old.duplicate_of is not null and new.duplicate_of is null then
      perform public.bank_audit(new.account_id, new.id, date_trunc('month', new.transaction_date)::date, 'duplicate_dismissed',
        jsonb_build_object('duplicate_of', old.duplicate_of));
    end if;
  elsif tg_op = 'DELETE' then
    perform public.bank_audit(old.account_id, null, date_trunc('month', old.transaction_date)::date, 'delete',
      jsonb_build_object('transaction_id', old.id, 'amount', old.amount, 'date', old.transaction_date, 'description', old.description));
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists bank_transactions_guard on public.bank_transactions;
create trigger bank_transactions_guard
  before insert or update or delete on public.bank_transactions
  for each row execute function public.bank_transaction_guard();
drop trigger if exists bank_transactions_audit on public.bank_transactions;
create trigger bank_transactions_audit
  after insert or update or delete on public.bank_transactions
  for each row execute function public.bank_transaction_audit();

-- ---------- المطابقات: منع التجاوز والازدواج ----------
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

create or replace function public.bank_match_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.bank_reconciliation_matches%rowtype;
  v_tx public.bank_transactions%rowtype;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  -- إعادة اشتقاق الحالة (المشغّل BEFORE UPDATE يحسبها)
  update public.bank_transactions set updated_at = now() where id = v_row.bank_transaction_id
  returning * into v_tx;
  if v_tx.id is null then return null; end if; -- الحركة نفسها محذوفة (cascade)
  perform public.bank_audit(v_tx.account_id, v_tx.id, date_trunc('month', v_tx.transaction_date)::date,
    case tg_op when 'INSERT' then 'match' when 'DELETE' then 'unmatch' else 'match_update' end,
    jsonb_build_object(
      'match_id', v_row.id, 'amount', v_row.amount, 'method', v_row.method, 'confidence', v_row.confidence,
      'target_type', case when v_row.expense_id is not null then 'expense' when v_row.invoice_payment_id is not null then 'invoice_payment'
                          when v_row.loan_payment_id is not null then 'loan_payment' else 'payroll_line' end,
      'target_id', coalesce(v_row.expense_id, v_row.invoice_payment_id, v_row.loan_payment_id, v_row.payroll_line_id),
      'tx_status', v_tx.status));
  return null;
end;
$$;

create trigger bank_matches_guard
  before insert or update or delete on public.bank_reconciliation_matches
  for each row execute function public.bank_match_guard();
create trigger bank_matches_after
  after insert or update or delete on public.bank_reconciliation_matches
  for each row execute function public.bank_match_after();

-- إعادة احتساب الحالات بعد نقل البيانات القديمة
update public.bank_transactions set updated_at = now();

-- ---------- الإقفال وإعادة الفتح ----------
create or replace function public.bank_reconciliation_close(
  p_account uuid, p_month date, p_statement_balance numeric, p_note text default null
)
returns public.bank_reconciliation_periods
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_open_prev date;
  v_unmatched int; v_partial int; v_dups int;
  v_opening numeric(14,2);
  v_computed numeric(14,2);
  v_snapshot jsonb;
  v_period public.bank_reconciliation_periods%rowtype;
begin
  if not (public.has_permission('bank_reconciliation') and public.can_write()) then
    raise exception 'لا تملك صلاحية المطابقة البنكية';
  end if;
  if p_statement_balance is null then raise exception 'أدخل الرصيد الختامي من كشف البنك'; end if;
  perform pg_advisory_xact_lock(hashtext('bank_close:' || p_account));

  if public.bank_period_is_closed(p_account, v_month) then
    raise exception 'الشهر % مقفل مسبقاً', to_char(v_month, 'YYYY-MM');
  end if;

  -- الإقفال تسلسلي: لا يُقفل شهر وقبله شهر فيه حركات ما زال مفتوحاً
  select min(date_trunc('month', t.transaction_date)::date) into v_open_prev
  from public.bank_transactions t
  where t.account_id = p_account and t.transaction_date < v_month
    and not public.bank_period_is_closed(p_account, t.transaction_date);
  if v_open_prev is not null then
    raise exception 'أقفل شهر % أولاً (الإقفال بالتسلسل)', to_char(v_open_prev, 'YYYY-MM');
  end if;

  select count(*) filter (where status = 'unmatched'),
         count(*) filter (where status = 'partially_matched'),
         count(*) filter (where duplicate_of is not null and status <> 'excluded')
    into v_unmatched, v_partial, v_dups
  from public.bank_transactions
  where account_id = p_account and transaction_date between v_month and v_end;
  if v_unmatched + v_partial + v_dups > 0 then
    raise exception 'لا يمكن الإقفال: % غير مطابقة، % مطابقة جزئياً، % مكررة محتملة', v_unmatched, v_partial, v_dups;
  end if;

  select opening_balance into v_opening from public.bank_accounts where id = p_account;
  if v_opening is null then raise exception 'الحساب غير موجود'; end if;
  select v_opening + coalesce(sum(amount), 0) into v_computed
  from public.bank_transactions where account_id = p_account and transaction_date <= v_end;

  if abs(p_statement_balance - v_computed) > 0.009 then
    raise exception 'فرق في الرصيد: كشف البنك % مقابل المحسوب % (الفرق %)', p_statement_balance, v_computed, p_statement_balance - v_computed;
  end if;

  select jsonb_build_object(
    'transactions', count(*),
    'matched', count(*) filter (where status = 'matched'),
    'excluded', count(*) filter (where status = 'excluded'),
    'inflow', coalesce(sum(amount) filter (where amount > 0), 0),
    'outflow', coalesce(sum(-amount) filter (where amount < 0), 0),
    'excluded_amount', coalesce(sum(amount) filter (where status = 'excluded'), 0)
  ) into v_snapshot
  from public.bank_transactions where account_id = p_account and transaction_date between v_month and v_end;

  insert into public.bank_reconciliation_periods as p
    (account_id, period_month, status, statement_closing_balance, computed_balance, difference, snapshot, note, closed_by, closed_at)
  values (p_account, v_month, 'closed', p_statement_balance, v_computed, p_statement_balance - v_computed, v_snapshot, p_note, auth.uid(), now())
  on conflict (account_id, period_month) do update
    set status = 'closed', statement_closing_balance = excluded.statement_closing_balance,
        computed_balance = excluded.computed_balance, difference = excluded.difference,
        snapshot = excluded.snapshot, note = excluded.note, closed_by = excluded.closed_by, closed_at = excluded.closed_at
  returning * into v_period;

  perform public.bank_audit(p_account, null, v_month, 'close',
    v_snapshot || jsonb_build_object('statement_balance', p_statement_balance, 'computed_balance', v_computed, 'note', p_note));
  return v_period;
end;
$$;

create or replace function public.bank_reconciliation_reopen(p_period uuid, p_reason text)
returns public.bank_reconciliation_periods
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period public.bank_reconciliation_periods%rowtype;
begin
  if not (public.has_permission('bank_reconciliation') and public.can_write()) then
    raise exception 'لا تملك صلاحية المطابقة البنكية';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'اكتب سبب إعادة الفتح';
  end if;
  select * into v_period from public.bank_reconciliation_periods where id = p_period for update;
  if not found or v_period.status <> 'closed' then raise exception 'الفترة غير مقفلة'; end if;
  if exists (select 1 from public.bank_reconciliation_periods
             where account_id = v_period.account_id and period_month > v_period.period_month and status = 'closed') then
    raise exception 'أعد فتح الأشهر اللاحقة أولاً';
  end if;
  update public.bank_reconciliation_periods
    set status = 'reopened', reopened_by = auth.uid(), reopened_at = now(), reopen_reason = trim(p_reason)
  where id = p_period returning * into v_period;
  perform public.bank_audit(v_period.account_id, null, v_period.period_month, 'reopen', jsonb_build_object('reason', trim(p_reason)));
  return v_period;
end;
$$;

revoke execute on function public.bank_reconciliation_close(uuid, date, numeric, text) from public, anon;
grant execute on function public.bank_reconciliation_close(uuid, date, numeric, text) to authenticated;
revoke execute on function public.bank_reconciliation_reopen(uuid, text) from public, anon;
grant execute on function public.bank_reconciliation_reopen(uuid, text) to authenticated;
revoke execute on function public.bank_transaction_guard() from public, anon, authenticated;
revoke execute on function public.bank_transaction_audit() from public, anon, authenticated;
revoke execute on function public.bank_match_guard() from public, anon, authenticated;
revoke execute on function public.bank_match_after() from public, anon, authenticated;

-- ---------- الصلاحيات ----------
alter table public.bank_reconciliation_matches enable row level security;
alter table public.bank_reconciliation_periods enable row level security;
alter table public.bank_reconciliation_audit enable row level security;

create policy permission_select on public.bank_reconciliation_matches for select to authenticated
  using ((select public.has_permission('bank_reconciliation')));
create policy permission_insert on public.bank_reconciliation_matches for insert to authenticated
  with check ((select public.has_permission('bank_reconciliation')) and (select public.can_write()));
create policy permission_update on public.bank_reconciliation_matches for update to authenticated
  using ((select public.has_permission('bank_reconciliation')) and (select public.can_write()))
  with check ((select public.has_permission('bank_reconciliation')) and (select public.can_write()));
create policy permission_delete on public.bank_reconciliation_matches for delete to authenticated
  using ((select public.has_permission('bank_reconciliation')) and (select public.can_write()));

-- الفترات وسجل المراجعة: قراءة فقط، والكتابة عبر الدوال أعلاه
create policy permission_select on public.bank_reconciliation_periods for select to authenticated
  using ((select public.has_permission('bank_reconciliation')));
create policy permission_select on public.bank_reconciliation_audit for select to authenticated
  using ((select public.has_permission('bank_reconciliation')));

grant select, insert, update, delete on public.bank_reconciliation_matches to authenticated;
grant select on public.bank_reconciliation_periods to authenticated;
grant select on public.bank_reconciliation_audit to authenticated;
