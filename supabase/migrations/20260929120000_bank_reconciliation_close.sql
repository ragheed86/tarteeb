-- الإقفال الشهري للمطابقة البنكية وسجل المراجعة.
-- الفكرة: الشهر المقفل يصير غير قابل للتعديل على مستوى قاعدة البيانات لا على مستوى الواجهة،
-- وكل تغيير على حالة الحركة يُسجَّل تلقائياً عبر مشغّل فلا يعتمد التسجيل على التطبيق.

create table public.reconciliation_periods (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.bank_accounts(id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date),
  status text not null default 'open' check (status in ('open', 'closed')),
  statement_closing_balance numeric(14,2),
  computed_balance numeric(14,2),
  note text,
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, month),
  constraint reconciliation_period_closed_fields check (
    status <> 'closed' or (closed_at is not null and computed_balance is not null)
  )
);

create table public.bank_transaction_audit (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.bank_transactions(id) on delete cascade,
  account_id uuid not null references public.bank_accounts(id) on delete cascade,
  transaction_date date not null,
  action text not null check (action in ('import', 'match', 'manual_match', 'exclude', 'reopen', 'edit')),
  old_status text,
  new_status text,
  old_expense_id uuid,
  new_expense_id uuid,
  old_payment_id uuid,
  new_payment_id uuid,
  confidence smallint,
  actor uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index reconciliation_periods_account_month_idx on public.reconciliation_periods(account_id, month desc);
create index bank_transaction_audit_tx_idx on public.bank_transaction_audit(transaction_id, created_at desc);
create index bank_transaction_audit_account_date_idx on public.bank_transaction_audit(account_id, transaction_date desc);

create trigger reconciliation_periods_set_updated_at
  before update on public.reconciliation_periods
  for each row execute function public.set_updated_at();

-- قفل الفترة: أي إدراج أو تعديل أو حذف لحركة تقع ضمن شهر مقفل يُرفض.
-- التعديل الذي ينقل الحركة من شهر مفتوح إلى شهر مقفل مرفوض أيضاً.
create or replace function public.guard_closed_reconciliation_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date;
  v_account uuid;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    v_month := date_trunc('month', new.transaction_date)::date;
    v_account := new.account_id;
    if exists (
      select 1 from public.reconciliation_periods p
      where p.account_id = v_account and p.month = v_month and p.status = 'closed'
    ) then
      raise exception 'الشهر % مقفل لهذا الحساب — أعد فتحه قبل التعديل', to_char(v_month, 'YYYY-MM')
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_month := date_trunc('month', old.transaction_date)::date;
    v_account := old.account_id;
    if exists (
      select 1 from public.reconciliation_periods p
      where p.account_id = v_account and p.month = v_month and p.status = 'closed'
    ) then
      raise exception 'الشهر % مقفل لهذا الحساب — أعد فتحه قبل التعديل', to_char(v_month, 'YYYY-MM')
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger bank_transactions_guard_closed_period
  before insert or update or delete on public.bank_transactions
  for each row execute function public.guard_closed_reconciliation_period();

-- سجل المراجعة: يُكتب تلقائياً عند الإدراج وعند أي تغيير في الحالة أو الربط.
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
     or old.matched_invoice_payment_id is distinct from new.matched_invoice_payment_id then
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
    old_status, new_status, old_expense_id, new_expense_id, old_payment_id, new_payment_id, confidence
  ) values (
    new.id, new.account_id, new.transaction_date, v_action,
    case when tg_op = 'INSERT' then null else old.status end,
    new.status,
    case when tg_op = 'INSERT' then null else old.matched_expense_id end,
    new.matched_expense_id,
    case when tg_op = 'INSERT' then null else old.matched_invoice_payment_id end,
    new.matched_invoice_payment_id,
    new.confidence
  );
  return new;
end;
$$;

create trigger bank_transactions_audit
  after insert or update on public.bank_transactions
  for each row execute function public.log_bank_transaction_change();

-- الإقفال: يرفض إذا بقيت حركات غير مطابقة في الشهر، ويثبّت الرصيد المحسوب وقت الإقفال.
create or replace function public.close_reconciliation_period(
  p_account_id uuid,
  p_month date,
  p_statement_closing_balance numeric default null,
  p_note text default null
)
returns public.reconciliation_periods
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_pending int;
  v_computed numeric(14,2);
  v_row public.reconciliation_periods;
begin
  select count(*) into v_pending
  from public.bank_transactions t
  where t.account_id = p_account_id
    and date_trunc('month', t.transaction_date)::date = v_month
    and t.status in ('unmatched', 'suggested');
  if v_pending > 0 then
    raise exception 'لا يمكن الإقفال: % حركة غير مطابقة في هذا الشهر', v_pending
      using errcode = 'check_violation';
  end if;

  select coalesce(a.opening_balance, 0) + coalesce(sum(t.amount) filter (
           where date_trunc('month', t.transaction_date)::date <= v_month
         ), 0)
    into v_computed
  from public.bank_accounts a
  left join public.bank_transactions t on t.account_id = a.id
  where a.id = p_account_id
  group by a.opening_balance;

  insert into public.reconciliation_periods as p (
    account_id, month, status, statement_closing_balance, computed_balance, note, closed_by, closed_at
  ) values (
    p_account_id, v_month, 'closed', p_statement_closing_balance, coalesce(v_computed, 0), p_note, auth.uid(), now()
  )
  on conflict (account_id, month) do update set
    status = 'closed',
    statement_closing_balance = excluded.statement_closing_balance,
    computed_balance = excluded.computed_balance,
    note = excluded.note,
    closed_by = excluded.closed_by,
    closed_at = excluded.closed_at
  returning p.* into v_row;

  return v_row;
end;
$$;

create or replace function public.reopen_reconciliation_period(p_account_id uuid, p_month date)
returns public.reconciliation_periods
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_row public.reconciliation_periods;
begin
  update public.reconciliation_periods
  set status = 'open', closed_by = null, closed_at = null
  where account_id = p_account_id and month = v_month
  returning * into v_row;
  if not found then
    raise exception 'لا توجد فترة مقفلة لهذا الشهر' using errcode = 'no_data_found';
  end if;
  return v_row;
end;
$$;

alter table public.reconciliation_periods enable row level security;
alter table public.bank_transaction_audit enable row level security;

create policy permission_select on public.reconciliation_periods for select to authenticated
  using ((select public.has_permission('bank_reconciliation')));
create policy permission_insert on public.reconciliation_periods for insert to authenticated
  with check ((select public.has_permission('bank_reconciliation')) and (select public.can_write()));
create policy permission_update on public.reconciliation_periods for update to authenticated
  using ((select public.has_permission('bank_reconciliation')) and (select public.can_write()))
  with check ((select public.has_permission('bank_reconciliation')) and (select public.can_write()));
create policy permission_delete on public.reconciliation_periods for delete to authenticated
  using ((select public.has_permission('bank_reconciliation')) and (select public.can_write()));

-- السجل للقراءة فقط من التطبيق؛ الكتابة تتم عبر المشغّل بصلاحية definer.
create policy permission_select on public.bank_transaction_audit for select to authenticated
  using ((select public.has_permission('bank_reconciliation')));

grant select, insert, update, delete on public.reconciliation_periods to authenticated;
grant select on public.bank_transaction_audit to authenticated;
grant execute on function public.close_reconciliation_period(uuid, date, numeric, text) to authenticated;
grant execute on function public.reopen_reconciliation_period(uuid, date) to authenticated;

-- دوال المشغّلات ليست نقاط RPC؛ سحب صلاحية التنفيذ يمنع استدعاءها من REST.
revoke execute on function public.guard_closed_reconciliation_period() from public, anon, authenticated;
revoke execute on function public.log_bank_transaction_change() from public, anon, authenticated;
