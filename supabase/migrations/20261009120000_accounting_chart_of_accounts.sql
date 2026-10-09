-- المحاسبة · دليل الحسابات (Chart of Accounts)
-- يضيف هيكل حسابات محاسبي قياسي (أصول/خصوم/حقوق ملكية/إيرادات/مصروفات) تُبنى عليه
-- القيود اليومية ودفتر الأستاذ والقوائم المالية في الملفات التالية. منصة "الأستاذ"
-- (alostaz.io) تبقى الجهة الوحيدة المعتمدة من هيئة الزكاة والضريبة والجمارك لإصدار
-- الفواتير — هذا الملف وما يليه محاسبة داخلية بحتة ولا علاقة له بإصدار الفواتير.

create table public.chart_of_accounts (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null unique,
  name_ar                text not null check (char_length(trim(name_ar)) > 0),
  name_en                text,
  account_type           text not null check (account_type in ('asset','liability','equity','revenue','expense')),
  normal_balance         text not null check (normal_balance in ('debit','credit')),
  parent_id              uuid references public.chart_of_accounts(id) on delete set null,
  is_system              boolean not null default false,
  linked_bank_account_id uuid references public.bank_accounts(id) on delete set null,
  active                 boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index chart_of_accounts_linked_bank_idx
  on public.chart_of_accounts(linked_bank_account_id) where linked_bank_account_id is not null;
create index chart_of_accounts_parent_idx on public.chart_of_accounts(parent_id);
create index chart_of_accounts_type_idx on public.chart_of_accounts(account_type);

create trigger chart_of_accounts_set_updated_at
  before update on public.chart_of_accounts
  for each row execute function public.set_updated_at();

-- ---------- Seed: header accounts ----------
insert into public.chart_of_accounts (code, name_ar, name_en, account_type, normal_balance, is_system) values
  ('1000', 'الأصول',       'Assets',      'asset',     'debit',  true),
  ('2000', 'الخصوم',       'Liabilities', 'liability', 'credit', true),
  ('3000', 'حقوق الملكية', 'Equity',      'equity',    'credit', true),
  ('4000', 'الإيرادات',    'Revenue',     'revenue',   'credit', true),
  ('5000', 'المصروفات',    'Expenses',    'expense',   'debit',  true);

-- ---------- Seed: level-2/3 accounts under each header ----------
insert into public.chart_of_accounts (code, name_ar, name_en, account_type, normal_balance, is_system, parent_id)
select v.code, v.name_ar, v.name_en, v.account_type, v.normal_balance, true, parent.id
from (values
  ('1100', 'النقدية والبنوك',                 'Cash & Banks',              'asset', 'debit',  '1000'),
  ('1120', 'ذمم العملاء',                      'Accounts Receivable',      'asset', 'debit',  '1000'),
  ('1140', 'ضريبة القيمة المضافة - مدخلات',    'Input VAT',                'asset', 'debit',  '1000'),
  ('2110', 'ذمم الموردين',                     'Accounts Payable',         'liability', 'credit', '2000'),
  ('2120', 'ضريبة القيمة المضافة - مخرجات',    'Output VAT',               'liability', 'credit', '2000'),
  ('2130', 'رواتب مستحقة الدفع',               'Salaries Payable',         'liability', 'credit', '2000'),
  ('2140', 'مستحقات التأمينات الاجتماعية (جوسي)', 'GOSI Payable',          'liability', 'credit', '2000'),
  ('2150', 'مزايا ومستحقات الموظفين الأخرى',    'Other Employee Benefits Payable', 'liability', 'credit', '2000'),
  ('2160', 'استقطاعات رواتب معلّقة',            'Payroll Deductions Clearing', 'liability', 'credit', '2000'),
  ('2210', 'قروض مستحقة',                      'Loans Payable',            'liability', 'credit', '2000'),
  ('3100', 'رأس المال',                        'Capital',                  'equity', 'credit', '3000'),
  ('3900', 'الأرباح المرحّلة ونتيجة الفترة',   'Retained Earnings & Period Result', 'equity', 'credit', '3000'),
  ('4100', 'إيرادات المبيعات والخدمات',        'Sales & Services Revenue', 'revenue', 'credit', '4000'),
  ('5200', 'مصروف الرواتب',                    'Salaries Expense',         'expense', 'debit', '5000'),
  ('5210', 'تكلفة صاحب العمل',                 'Employer Payroll Cost',    'expense', 'debit', '5000'),
  ('5300', 'مصاريف تشغيلية',                   'Operating Expenses',       'expense', 'debit', '5000'),
  ('5400', 'مصروف رسوم التمويل',               'Financing Fees Expense',   'expense', 'debit', '5000')
) as v(code, name_ar, name_en, account_type, normal_balance, parent_code)
join public.chart_of_accounts parent on parent.code = v.parent_code;

-- حساب تحكّم للحسابات البنكية — تُنشأ تحته حسابات فرعية تلقائيًا (1102-01, 1102-02...)
-- عبر trigger أدناه لكل صف في bank_accounts، وحساب الصندوق للدفعات النقدية،
-- وحساب "أموال غير مودعة" لدفعات بوسائل أخرى بلا حساب بنكي محدد.
insert into public.chart_of_accounts (code, name_ar, name_en, account_type, normal_balance, is_system, parent_id)
select v.code, v.name_ar, v.name_en, 'asset', 'debit', true, parent.id
from (values
  ('1101', 'الصندوق (نقدي)',       'Cash on Hand'),
  ('1102', 'حسابات بنكية',          'Bank Accounts'),
  ('1103', 'أموال غير مودعة',       'Undeposited Funds')
) as v(code, name_ar, name_en)
join public.chart_of_accounts parent on parent.code = '1100';

-- الحسابات الفرعية التشغيلية — واحد لكل فئة من company_expenses.category الحالية.
insert into public.chart_of_accounts (code, name_ar, name_en, account_type, normal_balance, is_system, parent_id)
select v.code, v.name_ar, v.name_en, 'expense', 'debit', true, parent.id
from (values
  ('5310', 'برمجيات',                      'Software'),
  ('5320', 'استضافة',                      'Hosting'),
  ('5330', 'معدات',                        'Equipment'),
  ('5340', 'مصاريف مكتبية',                'Office'),
  ('5350', 'تسويق',                        'Marketing'),
  ('5360', 'رواتب تشغيلية (تصنيف قديم)',   'Legacy Payroll Expense'),
  ('5370', 'قانوني',                       'Legal'),
  ('5380', 'صيانة',                        'Maintenance'),
  ('5390', 'مصاريف أخرى',                  'Other')
) as v(code, name_ar, name_en)
join public.chart_of_accounts parent on parent.code = '5300';

-- ---------- Dynamic per-bank-account sub-accounts ----------
create sequence public.chart_of_accounts_bank_seq start 1;

create or replace function public.chart_of_accounts_sync_bank_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent_id uuid;
  v_existing uuid;
begin
  select id into v_existing from public.chart_of_accounts where linked_bank_account_id = new.id;

  if v_existing is null then
    select id into v_parent_id from public.chart_of_accounts where code = '1102';
    insert into public.chart_of_accounts (
      code, name_ar, name_en, account_type, normal_balance, is_system, parent_id, linked_bank_account_id, active
    ) values (
      '1102-' || lpad(nextval('public.chart_of_accounts_bank_seq')::text, 2, '0'),
      'بنك: ' || new.name,
      'Bank: ' || new.name,
      'asset', 'debit', true, v_parent_id, new.id, new.active
    );
  else
    update public.chart_of_accounts
    set name_ar = 'بنك: ' || new.name,
        name_en = 'Bank: ' || new.name,
        active = new.active
    where id = v_existing;
  end if;

  return new;
end;
$$;

revoke execute on function public.chart_of_accounts_sync_bank_account() from public, anon, authenticated;

create trigger bank_accounts_sync_chart_of_accounts
  after insert or update of name, active on public.bank_accounts
  for each row execute function public.chart_of_accounts_sync_bank_account();

-- يبني حساب فرعي فوري لكل حساب بنكي موجود مسبقًا.
do $$
declare r record;
begin
  for r in select * from public.bank_accounts order by created_at loop
    insert into public.chart_of_accounts (
      code, name_ar, name_en, account_type, normal_balance, is_system, parent_id, linked_bank_account_id, active
    )
    select
      '1102-' || lpad(nextval('public.chart_of_accounts_bank_seq')::text, 2, '0'),
      'بنك: ' || r.name, 'Bank: ' || r.name, 'asset', 'debit', true,
      (select id from public.chart_of_accounts where code = '1102'),
      r.id, r.active
    where not exists (select 1 from public.chart_of_accounts where linked_bank_account_id = r.id);
  end loop;
end $$;

-- ---------- Permissions ----------
alter table public.chart_of_accounts enable row level security;

create policy permission_select on public.chart_of_accounts for select to authenticated
  using ((select public.has_permission('accounting')));
create policy permission_insert on public.chart_of_accounts for insert to authenticated
  with check ((select public.has_permission('accounting')) and is_system = false);
create policy permission_update on public.chart_of_accounts for update to authenticated
  using ((select public.has_permission('accounting')))
  with check ((select public.has_permission('accounting')));
create policy permission_delete on public.chart_of_accounts for delete to authenticated
  using ((select public.has_permission('accounting')) and is_system = false);

grant select, insert, update, delete on public.chart_of_accounts to authenticated;
grant usage, select on sequence public.chart_of_accounts_bank_seq to authenticated, service_role;
