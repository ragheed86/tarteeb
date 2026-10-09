'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getBalanceSheet, getIncomeStatement } from '@/lib/data';
import { fmtMoney } from '@/lib/format';
import { Loading, ErrorBar, KpiCard } from '@/components';

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 7)}-01`;
const sum = (rows, pick) => rows.reduce((total, row) => total + Number(pick(row) || 0), 0);

const TOOLS = [
  { href: '/accounting/chart-of-accounts', title: 'دليل الحسابات', desc: 'هيكل الحسابات المحاسبية — إضافة وتعطيل حسابات فرعية' },
  { href: '/accounting/journal', title: 'القيود اليومية', desc: 'القيود المُرحّلة تلقائيًا من الفواتير والمصاريف والرواتب والقروض + قيود يدوية' },
  { href: '/accounting/ledger', title: 'دفتر الأستاذ', desc: 'حركات كل حساب على حدة مع رصيد تراكمي' },
  { href: '/accounting/trial-balance', title: 'ميزان المراجعة', desc: 'إجمالي المدين والدائن لكل حساب حتى تاريخ معيّن — يجب أن يتوازن' },
];

export default function AccountingOverviewPage() {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [balanceSheet, incomeStatement] = await Promise.all([
          getBalanceSheet(today()), getIncomeStatement(monthStart(), today()),
        ]);
        setState({ balanceSheet, incomeStatement });
      } catch (loadError) {
        setError(loadError.message || 'تعذّر تحميل ملخص المحاسبة');
      }
    })();
  }, []);

  if (error) return <ErrorBar message={error} />;
  if (!state) return <Loading />;

  const assets = sum(state.balanceSheet.filter((row) => row.account_type === 'asset'), (row) => row.balance);
  const liabilities = sum(state.balanceSheet.filter((row) => row.account_type === 'liability'), (row) => row.balance);
  const equity = sum(state.balanceSheet.filter((row) => row.account_type === 'equity'), (row) => row.balance);
  const revenue = sum(state.incomeStatement.filter((row) => row.account_type === 'revenue'), (row) => row.amount);
  const expense = sum(state.incomeStatement.filter((row) => row.account_type === 'expense'), (row) => row.amount);

  return (
    <>
      <div className="sec-head">
        <div><h2>المحاسبة</h2><p>دليل الحسابات، القيود اليومية، دفتر الأستاذ، وميزان المراجعة — مبنية من قيد مزدوج فعلي.</p></div>
      </div>

      <div className="kpis">
        <KpiCard label="إجمالي الأصول" value={`${fmtMoney(assets)} ⃁`} definition="الرصيد التراكمي لكل حسابات الأصول حتى اليوم." period="حتى اليوم" formula="Σ أرصدة حسابات الأصول" />
        <KpiCard label="إجمالي الخصوم" value={`${fmtMoney(liabilities)} ⃁`} tone="alert" definition="الرصيد التراكمي لكل حسابات الخصوم حتى اليوم." period="حتى اليوم" formula="Σ أرصدة حسابات الخصوم" />
        <KpiCard label="حقوق الملكية" value={`${fmtMoney(equity)} ⃁`} definition="رأس المال + الأرباح المرحّلة + نتيجة الفترة الحالية غير المُقفلة." period="حتى اليوم" formula="Σ أرصدة حقوق الملكية" />
        <KpiCard label="صافي الربح (هذا الشهر)" value={`${fmtMoney(revenue - expense)} ⃁`} tone={revenue - expense >= 0 ? 'pos' : 'alert'} definition="إيرادات الشهر الحالي ناقص مصروفاته من القيود الفعلية." period="من بداية الشهر حتى اليوم" formula="الإيرادات − المصروفات" />
      </div>

      <div className="sec-head"><div><h2>أدوات المحاسبة</h2></div></div>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
        {TOOLS.map((tool) => (
          <Link key={tool.href} href={tool.href} className="card" style={{ display: 'block', padding: 16, textDecoration: 'none', color: 'inherit' }}>
            <h3 style={{ margin: '0 0 6px' }}>{tool.title}</h3>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>{tool.desc}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
