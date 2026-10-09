-- المحاسبة · دوال التقارير (ميزان مراجعة / دفتر أستاذ / قائمة دخل / ميزانية عمومية)
-- وقيد يدوي + عكس قيد. دوال القراءة stable + security invoker (تعتمد على RLS نفسها)،
-- بنفس نمط dashboard_metrics. دوال الكتابة security definer بفحص صلاحية صريح،
-- بنفس نمط payroll_lock.

-- ---------- ميزان المراجعة (رصيد تراكمي حتى تاريخ معيّن) ----------
create or replace function public.accounting_trial_balance(p_as_of date)
returns table (
  account_id uuid, code text, name_ar text, name_en text, account_type text,
  debit numeric, credit numeric, balance numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select coa.id, coa.code, coa.name_ar, coa.name_en, coa.account_type,
    coalesce(sum(l.debit), 0) as debit,
    coalesce(sum(l.credit), 0) as credit,
    case when coa.normal_balance = 'debit'
      then coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0)
      else coalesce(sum(l.credit), 0) - coalesce(sum(l.debit), 0)
    end as balance
  from public.chart_of_accounts coa
  join public.journal_entry_lines l on l.account_id = coa.id
  join public.journal_entries je on je.id = l.entry_id
  where je.entry_date <= p_as_of
  group by coa.id, coa.code, coa.name_ar, coa.name_en, coa.account_type, coa.normal_balance
  order by coa.code;
$$;

-- ---------- دفتر الأستاذ لحساب واحد مع رصيد تراكمي ----------
create or replace function public.accounting_ledger(p_account_id uuid, p_from date, p_to date)
returns table (
  entry_id uuid, entry_no text, entry_date date, description text,
  debit numeric, credit numeric, running_balance numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with opening as (
    select coalesce(sum(case when coa.normal_balance = 'debit' then l.debit - l.credit else l.credit - l.debit end), 0) as bal
    from public.journal_entry_lines l
    join public.journal_entries je on je.id = l.entry_id
    join public.chart_of_accounts coa on coa.id = l.account_id
    where l.account_id = p_account_id and je.entry_date < p_from
  ),
  movements as (
    select je.id as entry_id, je.entry_no, je.entry_date, je.description, l.debit, l.credit, coa.normal_balance
    from public.journal_entry_lines l
    join public.journal_entries je on je.id = l.entry_id
    join public.chart_of_accounts coa on coa.id = l.account_id
    where l.account_id = p_account_id and je.entry_date between p_from and p_to
  )
  select m.entry_id, m.entry_no, m.entry_date, m.description, m.debit, m.credit,
    (select bal from opening) + sum(case when m.normal_balance = 'debit' then m.debit - m.credit else m.credit - m.debit end)
      over (order by m.entry_date, m.entry_id)
  from movements m
  order by m.entry_date, m.entry_id;
$$;

-- ---------- قائمة الدخل (حركة الفترة لحسابات الإيرادات/المصروفات فقط) ----------
create or replace function public.accounting_income_statement(p_from date, p_to date)
returns table (account_type text, code text, name_ar text, name_en text, amount numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select coa.account_type, coa.code, coa.name_ar, coa.name_en,
    case when coa.account_type = 'revenue'
      then coalesce(sum(l.credit - l.debit), 0)
      else coalesce(sum(l.debit - l.credit), 0)
    end as amount
  from public.chart_of_accounts coa
  join public.journal_entry_lines l on l.account_id = coa.id
  join public.journal_entries je on je.id = l.entry_id
  where coa.account_type in ('revenue', 'expense') and je.entry_date between p_from and p_to
  group by coa.account_type, coa.code, coa.name_ar, coa.name_en
  order by coa.code;
$$;

-- ---------- الميزانية العمومية (أرصدة تراكمية حتى تاريخ، + نتيجة الفترة الحالية كبند حقوق ملكية) ----------
create or replace function public.accounting_balance_sheet(p_as_of date)
returns table (account_type text, code text, name_ar text, name_en text, balance numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select coa.account_type, coa.code, coa.name_ar, coa.name_en,
    case when coa.normal_balance = 'debit'
      then coalesce(sum(l.debit - l.credit), 0)
      else coalesce(sum(l.credit - l.debit), 0)
    end as balance
  from public.chart_of_accounts coa
  join public.journal_entry_lines l on l.account_id = coa.id
  join public.journal_entries je on je.id = l.entry_id
  where coa.account_type in ('asset', 'liability', 'equity') and je.entry_date <= p_as_of
  group by coa.account_type, coa.code, coa.name_ar, coa.name_en, coa.normal_balance
  union all
  select 'equity', '3900-net', 'نتيجة الفترة الحالية (غير مُقفلة)', 'Current Period Result (Unclosed)',
    coalesce((
      select sum(l2.credit - l2.debit)
      from public.journal_entry_lines l2
      join public.journal_entries je2 on je2.id = l2.entry_id
      join public.chart_of_accounts coa2 on coa2.id = l2.account_id
      where coa2.account_type in ('revenue', 'expense') and je2.entry_date <= p_as_of
    ), 0)
  order by code;
$$;

-- ---------- قيد يدوي (تسويات/إهلاك/تصحيح) ----------
create or replace function public.accounting_create_manual_entry(
  p_entry_date date,
  p_description text,
  p_lines jsonb
)
returns public.journal_entries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry public.journal_entries%rowtype;
begin
  if not public.has_permission('accounting') then
    raise exception 'لا تملك صلاحية المحاسبة';
  end if;

  v_entry := public.accounting_post(p_entry_date, p_description, null, null, 'default', p_lines, true);
  return v_entry;
end;
$$;

revoke execute on function public.accounting_create_manual_entry(date, text, jsonb) from public, anon;
grant execute on function public.accounting_create_manual_entry(date, text, jsonb) to authenticated;

-- ---------- عكس قيد يدوي ----------
-- مسموح فقط على القيود اليدوية: عكس قيد مُرحَّل تلقائيًا من مستند تشغيلي (فاتورة/مصروف/...)
-- يخلق تعارضًا مع trigger ذلك المستند عند أي تحديث لاحق عليه — التصحيح الصحيح لقيد تلقائي
-- هو تعديل المستند المصدر نفسه، لا عكس قيده المحاسبي مباشرة.
create or replace function public.accounting_reverse_entry(p_entry_id uuid)
returns public.journal_entries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_original public.journal_entries%rowtype;
  v_lines jsonb;
  v_reversed public.journal_entries%rowtype;
begin
  if not public.has_permission('accounting') then
    raise exception 'لا تملك صلاحية المحاسبة';
  end if;

  select * into v_original from public.journal_entries where id = p_entry_id;
  if v_original.id is null then
    raise exception 'القيد غير موجود';
  end if;
  if not v_original.is_manual then
    raise exception 'لا يمكن عكس قيد مُرحَّل تلقائيًا من مستند تشغيلي — عدّل المستند المصدر بدلاً من ذلك';
  end if;
  if v_original.reversed_by is not null then
    raise exception 'القيد مُعكوس مسبقًا';
  end if;

  select jsonb_agg(jsonb_build_object(
    'account_code', coa.code, 'debit', jel.credit, 'credit', jel.debit,
    'client_id', jel.client_id, 'supplier_id', jel.supplier_id, 'project_id', jel.project_id,
    'employee_id', jel.employee_id, 'loan_id', jel.loan_id, 'note', jel.note
  ))
  into v_lines
  from public.journal_entry_lines jel
  join public.chart_of_accounts coa on coa.id = jel.account_id
  where jel.entry_id = p_entry_id;

  v_reversed := public.accounting_post(
    current_date, 'عكس قيد ' || v_original.entry_no, null, null, 'default', v_lines, true
  );

  update public.journal_entries set reversed_by = v_reversed.id where id = p_entry_id;
  return v_reversed;
end;
$$;

revoke execute on function public.accounting_reverse_entry(uuid) from public, anon;
grant execute on function public.accounting_reverse_entry(uuid) to authenticated;

grant execute on function public.accounting_trial_balance(date) to authenticated;
grant execute on function public.accounting_ledger(uuid, date, date) to authenticated;
grant execute on function public.accounting_income_statement(date, date) to authenticated;
grant execute on function public.accounting_balance_sheet(date) to authenticated;
