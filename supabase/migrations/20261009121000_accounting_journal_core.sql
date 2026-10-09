-- المحاسبة · القيود اليومية (قيد مزدوج) ودفتر الأستاذ — البنية الأساسية.
-- كل قيد يُرحَّل فورًا (Posted) ولا توجد حالة "مسودة"؛ التصحيح يتم بقيد عكسي جديد
-- (انظر accounting_reverse_entry في ملف القوائم المالية) لا بتعديل قيد قائم.

create sequence public.journal_entry_seq start 1;
grant usage, select on sequence public.journal_entry_seq to authenticated, service_role;

create table public.journal_entries (
  id            uuid primary key default gen_random_uuid(),
  entry_no      text not null unique,
  entry_date    date not null,
  description   text not null check (char_length(trim(description)) > 0),
  source_table  text,
  source_id     uuid,
  source_event  text not null default 'default',
  is_manual     boolean not null default false,
  reversed_by   uuid references public.journal_entries(id) on delete set null,
  created_by    uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create unique index journal_entries_source_idx
  on public.journal_entries(source_table, source_id, source_event) where source_table is not null;
create index journal_entries_date_idx on public.journal_entries(entry_date desc);

create table public.journal_entry_lines (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references public.journal_entries(id) on delete cascade,
  account_id  uuid not null references public.chart_of_accounts(id),
  debit       numeric(14,2) not null default 0 check (debit >= 0),
  credit      numeric(14,2) not null default 0 check (credit >= 0),
  client_id   uuid references public.clients(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  project_id  uuid references public.projects(id) on delete set null,
  employee_id uuid references public.employees(id) on delete set null,
  loan_id     uuid references public.loans(id) on delete set null,
  note        text,
  constraint journal_entry_lines_one_side check (
    (debit > 0 and credit = 0) or (credit > 0 and debit = 0)
  )
);

create index journal_entry_lines_entry_idx on public.journal_entry_lines(entry_id);
create index journal_entry_lines_account_idx on public.journal_entry_lines(account_id);
create index journal_entry_lines_client_idx on public.journal_entry_lines(client_id) where client_id is not null;
create index journal_entry_lines_supplier_idx on public.journal_entry_lines(supplier_id) where supplier_id is not null;
create index journal_entry_lines_project_idx on public.journal_entry_lines(project_id) where project_id is not null;

-- ---------- دالة الترحيل المشتركة (داخلية فقط) ----------
-- p_lines: jsonb array لكل عنصر {account_code, debit, credit, client_id?, supplier_id?, project_id?, employee_id?, loan_id?, note?}
-- التحقق من توازن القيد (مدين = دائن) هنا، لا على مستوى الجدول، لتفادي تعقيد trigger-per-row.
-- مُحمية بـ idempotency: استدعاء بنفس (source_table, source_id, source_event) لا يُنشئ قيدًا مكررًا،
-- بل يُعيد القيد الموجود — فتشغيل الـbackfill أكثر من مرة آمن.
create or replace function public.accounting_post(
  p_entry_date   date,
  p_description  text,
  p_source_table text,
  p_source_id    uuid,
  p_source_event text,
  p_lines        jsonb,
  p_is_manual    boolean default false
)
returns public.journal_entries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry public.journal_entries%rowtype;
  v_total_debit numeric(14,2);
  v_total_credit numeric(14,2);
  v_line record;
  v_account_id uuid;
  v_event text := coalesce(p_source_event, 'default');
begin
  if p_source_table is not null then
    select * into v_entry from public.journal_entries
      where source_table = p_source_table and source_id = p_source_id and source_event = v_event;
    if found then
      return v_entry;
    end if;
  end if;

  select coalesce(sum((line->>'debit')::numeric), 0), coalesce(sum((line->>'credit')::numeric), 0)
  into v_total_debit, v_total_credit
  from jsonb_array_elements(p_lines) as line;

  if v_total_debit = 0 and v_total_credit = 0 then
    raise exception 'القيد لا يحتوي على أي مبلغ';
  end if;
  if round(v_total_debit, 2) <> round(v_total_credit, 2) then
    raise exception 'القيد غير متوازن: مدين % مقابل دائن %', v_total_debit, v_total_credit;
  end if;

  insert into public.journal_entries (
    entry_no, entry_date, description, source_table, source_id, source_event, is_manual
  ) values (
    'JE-' || lpad(nextval('public.journal_entry_seq')::text, 6, '0'),
    p_entry_date, p_description, p_source_table, p_source_id, v_event, coalesce(p_is_manual, false)
  )
  returning * into v_entry;

  for v_line in
    select * from jsonb_to_recordset(p_lines) as x(
      account_code text, debit numeric, credit numeric,
      client_id uuid, supplier_id uuid, project_id uuid, employee_id uuid, loan_id uuid, note text
    )
  loop
    if coalesce(v_line.debit, 0) = 0 and coalesce(v_line.credit, 0) = 0 then
      continue;
    end if;

    select id into v_account_id from public.chart_of_accounts where code = v_line.account_code;
    if v_account_id is null then
      raise exception 'حساب محاسبي غير معروف بالكود: %', v_line.account_code;
    end if;

    insert into public.journal_entry_lines (
      entry_id, account_id, debit, credit, client_id, supplier_id, project_id, employee_id, loan_id, note
    ) values (
      v_entry.id, v_account_id, coalesce(v_line.debit, 0), coalesce(v_line.credit, 0),
      v_line.client_id, v_line.supplier_id, v_line.project_id, v_line.employee_id, v_line.loan_id, v_line.note
    );
  end loop;

  return v_entry;
end;
$$;

-- داخلي فقط: تُستدعى من دوال trigger الترحيل (البند التالي) ومن دالة القيد اليدوي،
-- وكلتاهما security definer. لا يجوز استدعاؤها مباشرة عبر PostgREST.
revoke execute on function public.accounting_post(date, text, text, uuid, text, jsonb, boolean) from public, anon, authenticated;

-- ---------- Permissions (القراءة فقط عبر RLS؛ الكتابة من خلال الدوال أعلاه فقط) ----------
alter table public.journal_entries enable row level security;
alter table public.journal_entry_lines enable row level security;

create policy permission_select on public.journal_entries for select to authenticated
  using ((select public.has_permission('accounting')));
create policy permission_select on public.journal_entry_lines for select to authenticated
  using ((select public.has_permission('accounting')));

grant select on public.journal_entries to authenticated;
grant select on public.journal_entry_lines to authenticated;
