'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  getClients, getProjects, getInvoices, getAllInvoicePayments, getAllInvoiceItems,
  getAllProjectCosts, getInventory, getCompanyExpenses, getSuppliers,
  getBankAccounts, getBankTransactions,
} from '@/lib/data';
import { fmtMoney, fmtNum, fmtDate, INVOICE_STATUS, PROJECT_STATUS } from '@/lib/format';
import { Loading, Empty, ErrorBar, DataTable, KpiCard, Money, DateText, StatusPill } from '@/components';

const TABS = [
  ['overview', 'نظرة تنفيذية'], ['financial', 'المالية'], ['sales', 'المبيعات والعملاء'],
  ['projects', 'المشاريع والربحية'], ['purchases', 'المشتريات والموردون'], ['inventory', 'المخزون'],
];
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 7)}-01`;
const n = (value) => Number(value || 0);
const isOrganizers = (value) => /منظمات?|منظّمات?|أدوات\s*الترتيب|ادوات\s*الترتيب|التخزين/i.test(String(value || ''));
const inRange = (value, from, to) => {
  const date = String(value || '').slice(0, 10);
  return Boolean(date) && (!from || date >= from) && (!to || date <= to);
};
const sum = (rows, pick) => rows.reduce((total, row) => total + n(pick(row)), 0);

export default function ReportsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);

  useEffect(() => {
    (async () => {
      try {
        const [clients, projects, invoices, payments, invoiceItems, costs, inventory, expenses, suppliers, bankAccounts] = await Promise.all([
          getClients(), getProjects(), getInvoices(), getAllInvoicePayments(), getAllInvoiceItems(),
          getAllProjectCosts(), getInventory(), getCompanyExpenses().catch(() => []), getSuppliers().catch(() => []), getBankAccounts().catch(() => []),
        ]);
        const bankTransactions = (await Promise.all(bankAccounts.map((account) => getBankTransactions(account.id).catch(() => [])))).flat();
        setData({ clients, projects, invoices, payments, invoiceItems, costs, inventory, expenses, suppliers, bankAccounts, bankTransactions });
      } catch (loadError) {
        setError(loadError.message || 'تعذّر تحميل التقارير');
      }
    })();
  }, []);

  const report = useMemo(() => {
    if (!data) return null;
    const invoices = data.invoices.filter((invoice) => invoice.status !== 'refunded');
    const periodInvoices = invoices.filter((invoice) => inRange(invoice.issue_at, from, to));
    const periodPayments = data.payments.filter((payment) => inRange(payment.paid_at, from, to));
    const periodCosts = data.costs.filter((cost) => inRange(cost.work_date || cost.created_at, from, to));
    const periodExpenses = data.expenses.filter((expense) => expense.payment_status === 'paid' && inRange(expense.expense_date, from, to));
    const periodItems = data.invoiceItems.filter((item) => inRange(item.invoices?.issue_at, from, to));
    const collected = sum(periodPayments, (payment) => payment.amount);
    const billed = sum(periodInvoices, (invoice) => invoice.total);
    const projectCosts = sum(periodCosts, (cost) => cost.amount);
    const companyExpenses = sum(periodExpenses, (expense) => expense.amount);
    const netProfit = collected - projectCosts - companyExpenses;
    const organizersSales = sum(periodItems.filter((item) => isOrganizers(item.description)), (item) => n(item.qty) * n(item.unit_price));
    const serviceSales = sum(periodItems.filter((item) => !isOrganizers(item.description)), (item) => n(item.qty) * n(item.unit_price));
    const organizersCosts = sum(periodCosts.filter((cost) => isOrganizers(`${cost.product_name || ''} ${cost.label || ''} ${cost.note || ''}`)), (cost) => cost.amount);
    const serviceCosts = projectCosts - organizersCosts;
    const byClient = new Map();
    for (const invoice of periodInvoices) {
      const row = byClient.get(invoice.client_id) || { client_id: invoice.client_id, invoices: 0, billed: 0, collected: 0 };
      row.invoices += 1; row.billed += n(invoice.total); byClient.set(invoice.client_id, row);
    }
    for (const payment of periodPayments) {
      const invoice = invoices.find((item) => item.id === payment.invoice_id);
      if (!invoice?.client_id) continue;
      const row = byClient.get(invoice.client_id) || { client_id: invoice.client_id, invoices: 0, billed: 0, collected: 0 };
      row.collected += n(payment.amount); byClient.set(invoice.client_id, row);
    }
    const clientNames = Object.fromEntries(data.clients.map((client) => [client.id, client.name]));
    const clientRows = [...byClient.values()].map((row) => ({ ...row, client: clientNames[row.client_id] || 'عميل محذوف' })).sort((a, b) => b.billed - a.billed);
    const projectCostsById = data.costs.reduce((all, cost) => ({ ...all, [cost.project_id]: n(all[cost.project_id]) + n(cost.amount) }), {});
    const projectRows = data.projects.filter((project) => inRange(project.start_date || project.created_at, from, to)).map((project) => {
      const cost = n(projectCostsById[project.id]);
      const sale = n(project.sale_price);
      return { ...project, client: clientNames[project.client_id] || '—', cost, profit: sale - cost, margin: sale ? Math.round(((sale - cost) / sale) * 100) : 0 };
    }).sort((a, b) => b.profit - a.profit);
    const supplierPurchases = new Map();
    for (const cost of periodCosts.filter((item) => item.kind === 'materials')) {
      const key = cost.supplier_id || cost.supplier_name || 'بدون مورد';
      const row = supplierPurchases.get(key) || { supplier: cost.supplier_name || data.suppliers.find((supplier) => supplier.id === cost.supplier_id)?.name || 'بدون مورد', purchases: 0, items: 0 };
      row.purchases += n(cost.amount); row.items += 1; supplierPurchases.set(key, row);
    }
    const supplierRows = [...supplierPurchases.values()].sort((a, b) => b.purchases - a.purchases);
    const lowStock = data.inventory.filter((item) => n(item.quantity) < n(item.reorder_level));
    const inventoryValue = sum(data.inventory, (item) => n(item.quantity) * n(item.unit_cost));
    const bankBalance = sum(data.bankAccounts, (account) => account.opening_balance) + sum(data.bankTransactions, (transaction) => transaction.amount);
    const bankFlow = sum(data.bankTransactions.filter((transaction) => inRange(transaction.transaction_date, from, to)), (transaction) => transaction.amount);
    const receivables = sum(invoices, (invoice) => invoice.remaining_amount);
    const overdue = invoices.filter((invoice) => invoice.status === 'overdue');
    return {
      periodInvoices, periodCosts, periodExpenses, collected, billed, projectCosts, companyExpenses, netProfit,
      serviceSales, serviceCosts, organizersSales, organizersCosts, clientRows, projectRows, supplierRows,
      lowStock, inventoryValue, bankBalance, bankFlow, receivables, overdue,
    };
  }, [data, from, to]);

  if (error) return <ErrorBar message={error} />;
  if (!data || !report) return <Loading />;

  const scope = `${fmtDate(from)} — ${fmtDate(to)}`;
  const setQuick = (key) => {
    const end = today();
    const start = new Date();
    if (key === 'month') start.setDate(1);
    if (key === 'quarter') start.setMonth(start.getMonth() - 2, 1);
    if (key === 'year') start.setMonth(0, 1);
    setFrom(start.toISOString().slice(0, 10)); setTo(end);
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="reports-head">
        <div><h2>التقارير</h2><p>تقارير مالية وتشغيلية من بيانات النظام الفعلية.</p></div>
        <button className="btn ghost" type="button" onClick={() => window.print()}>طباعة / حفظ PDF</button>
      </div>

      <div className="card report-filters">
        <div className="field"><label>من تاريخ</label><input type="date" value={from} max={to || undefined} dir="ltr" onChange={(event) => setFrom(event.target.value)} /></div>
        <div className="field"><label>إلى تاريخ</label><input type="date" value={to} min={from || undefined} dir="ltr" onChange={(event) => setTo(event.target.value)} /></div>
        <div className="report-quick">{[['month', 'هذا الشهر'], ['quarter', 'آخر 3 أشهر'], ['year', 'هذه السنة']].map(([key, label]) => <button className="btn ghost sm" type="button" key={key} onClick={() => setQuick(key)}>{label}</button>)}</div>
      </div>

      <div className="report-tabs" role="tablist">{TABS.map(([key, label]) => <button type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} key={key} onClick={() => setTab(key)}>{label}</button>)}</div>

      {tab === 'overview' && <Overview report={report} scope={scope} />}
      {tab === 'financial' && <Financial report={report} scope={scope} />}
      {tab === 'sales' && <Sales report={report} scope={scope} />}
      {tab === 'projects' && <Projects report={report} scope={scope} />}
      {tab === 'purchases' && <Purchases report={report} scope={scope} />}
      {tab === 'inventory' && <Inventory report={report} scope={scope} />}
    </>
  );
}

function Overview({ report, scope }) {
  return <>
    <Section title="الملخص التنفيذي" subtitle={scope} />
    <div className="kpis report-kpis">
      <Metric label="الإيرادات المحصّلة" value={report.collected} tone="pos" />
      <Metric label="المبالغ المفوترة" value={report.billed} />
      <Metric label="تكاليف المشاريع" value={report.projectCosts} tone="alert" />
      <Metric label="مصاريف الشركة" value={report.companyExpenses} tone="alert" />
      <Metric label="صافي الربح النقدي" value={report.netProfit} tone={report.netProfit >= 0 ? 'pos' : 'alert'} />
      <Metric label="حصة كل شريك" value={report.netProfit / 2} tone={report.netProfit >= 0 ? 'pos' : 'alert'} />
    </div>
    <div className="grid2 report-grid"><Statement report={report} /><Receivables report={report} /></div>
  </>;
}

function Financial({ report, scope }) {
  return <>
    <Section title="التقارير المالية" subtitle={`قائمة الدخل والتدفقات النقدية · ${scope}`} />
    <div className="grid2 report-grid"><Statement report={report} /><CashFlow report={report} /></div>
    <div className="grid2 report-grid"><Receivables report={report} /><div className="card report-note"><h3>تقارير محاسبية متقدمة</h3><p>ميزان المراجعة، دفتر الأستاذ العام، الميزانية العمومية، والإقرار الضريبي تحتاج إلى وحدة قيود محاسبية وربط ضريبي مستقل قبل عرض أرقام محاسبية معتمدة.</p></div></div>
  </>;
}

function Sales({ report, scope }) {
  return <>
    <Section title="المبيعات والعملاء" subtitle={scope} />
    <div className="kpis report-kpis"><Metric label="مفوتر" value={report.billed} /><Metric label="محصّل" value={report.collected} tone="pos" /><Metric label="ذمم العملاء" value={report.receivables} tone="alert" /><Metric label="فواتير متأخرة" value={report.overdue.length} numeric tone="alert" /></div>
    <div className="card report-table"><DataTable rows={report.clientRows} empty={<Empty title="لا مبيعات ضمن الفترة" desc="غيّر فلتر التاريخ لعرض العملاء المفوترين." />} columns={[
      { key: 'client', label: 'العميل', primary: true, render: (row) => <span className="nm">{row.client}</span> },
      { key: 'invoices', label: 'الفواتير', render: (row) => fmtNum(row.invoices) },
      { key: 'billed', label: 'المفوتر', render: (row) => <Money v={row.billed} /> },
      { key: 'collected', label: 'المحصّل', render: (row) => <Money v={row.collected} /> },
    ]} /></div>
  </>;
}

function Projects({ report, scope }) {
  const serviceProfit = report.serviceSales - report.serviceCosts;
  const organizersProfit = report.organizersSales - report.organizersCosts;
  return <>
    <Section title="المشاريع والربحية" subtitle={scope} />
    <div className="kpis report-kpis"><Metric label="ربح الخدمة" value={serviceProfit} tone={serviceProfit >= 0 ? 'pos' : 'alert'} /><Metric label="ربح المنظمات" value={organizersProfit} tone={organizersProfit >= 0 ? 'pos' : 'alert'} /><Metric label="مشاريع الفترة" value={report.projectRows.length} numeric /><Metric label="تكلفة المشاريع" value={report.projectCosts} tone="alert" /></div>
    <div className="card report-table"><DataTable rows={report.projectRows} empty={<Empty title="لا مشاريع ضمن الفترة" desc="يعتمد التقرير على تاريخ بداية المشروع." />} columns={[
      { key: 'title', label: 'المشروع', primary: true, render: (row) => <><span className="nm">{row.title}</span><small>{row.client}</small></> },
      { key: 'sale_price', label: 'بيع الخدمة', render: (row) => <Money v={row.sale_price} /> },
      { key: 'cost', label: 'التكلفة', render: (row) => <Money v={row.cost} /> },
      { key: 'profit', label: 'الربح', render: (row) => <Money v={row.profit} /> },
      { key: 'status', label: 'الحالة', render: (row) => <StatusPill status={row.status} map={PROJECT_STATUS} /> },
    ]} /></div>
  </>;
}

function Purchases({ report, scope }) {
  return <>
    <Section title="المشتريات والموردون" subtitle={`مشتريات المواد المسجّلة في تكاليف المشاريع · ${scope}`} />
    <div className="kpis report-kpis"><Metric label="إجمالي شراء المواد" value={sum(report.supplierRows, (row) => row.purchases)} /><Metric label="الموردون المستخدمون" value={report.supplierRows.length} numeric /><Metric label="بنود المواد" value={sum(report.supplierRows, (row) => row.items)} numeric /></div>
    <div className="card report-table"><DataTable rows={report.supplierRows} empty={<Empty title="لا مشتريات مواد ضمن الفترة" desc="أضف المورد وسعر الشراء في تكلفة المشروع لتظهر هنا." />} columns={[
      { key: 'supplier', label: 'المورد', primary: true, render: (row) => <span className="nm">{row.supplier}</span> },
      { key: 'items', label: 'عدد البنود', render: (row) => fmtNum(row.items) },
      { key: 'purchases', label: 'قيمة المشتريات', render: (row) => <Money v={row.purchases} /> },
    ]} /></div>
  </>;
}

function Inventory({ report, scope }) {
  return <>
    <Section title="تقارير المخزون" subtitle={`حالة المخزون الحالية · ${scope}`} />
    <div className="kpis report-kpis"><Metric label="قيمة المخزون" value={report.inventoryValue} /><Metric label="أصناف تحت الحد" value={report.lowStock.length} numeric tone="alert" /></div>
    <div className="card report-table"><DataTable rows={report.lowStock} empty={<Empty title="المخزون بحالة جيدة" desc="لا توجد أصناف أقل من حد إعادة الطلب." />} columns={[
      { key: 'name', label: 'الصنف', primary: true, render: (row) => <span className="nm">{row.name}</span> },
      { key: 'quantity', label: 'المتاح', render: (row) => fmtNum(row.quantity) },
      { key: 'reorder_level', label: 'حد التنبيه', render: (row) => fmtNum(row.reorder_level) },
      { key: 'value', label: 'القيمة', render: (row) => <Money v={n(row.quantity) * n(row.unit_cost)} /> },
    ]} /></div>
  </>;
}

function Statement({ report }) {
  return <div className="card report-statement"><h3>قائمة الدخل النقدية</h3><p>تعتمد على الدفعات المحصلة والتكاليف والمصاريف المدفوعة.</p><Line label="الإيرادات المحصّلة" value={report.collected} /><Line label="تكاليف المشاريع" value={-report.projectCosts} negative /><Line label="مصاريف الشركة" value={-report.companyExpenses} negative /><Line label="صافي الربح النقدي" value={report.netProfit} total /></div>;
}
function CashFlow({ report }) {
  return <div className="card report-statement"><h3>التدفق النقدي والبنك</h3><p>حركة نقدية الفترة مع الرصيد البنكي بعد الحركات المستوردة.</p><Line label="داخل الفترة" value={report.collected} /><Line label="خارج الفترة" value={-(report.projectCosts + report.companyExpenses)} negative /><Line label="صافي حركة البنك" value={report.bankFlow} total /><Line label="الرصيد الحالي بالبنك" value={report.bankBalance} total /></div>;
}
function Receivables({ report }) {
  return <div className="card report-statement"><h3>الذمم المدينة</h3><p>المبالغ المتبقية على الفواتير غير المرتجعة.</p><Line label="إجمالي الذمم" value={report.receivables} /><Line label="فواتير متأخرة" value={report.overdue.length} count /><Line label="قيمة المتأخر" value={sum(report.overdue, (invoice) => invoice.remaining_amount)} total /></div>;
}
function Line({ label, value, negative, total, count }) { return <div className={`statement-line${total ? ' total' : ''}`}><span>{label}</span><b className={negative ? 'negative' : ''}>{count ? fmtNum(value) : `${fmtMoney(value)} ⃁`}</b></div>; }
function Section({ title, subtitle }) { return <div className="sec-head report-section"><div><h2>{title}</h2><span className="more">{subtitle}</span></div></div>; }
function Metric({ label, value, tone, numeric = false }) { return <KpiCard label={label} tone={tone} value={numeric ? fmtNum(value) : `${fmtMoney(value)} ⃁`} definition="قيمة محسوبة من السجلات ضمن نطاق التقرير المختار." period="الفترة المختارة" formula="تجميع بيانات النظام المطابقة لفلتر التاريخ" />; }

const CSS = `
.reports-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:16px}.reports-head h2{margin:0}.reports-head p{margin:5px 0 0;color:var(--muted);font-size:13px}.report-filters{display:flex;align-items:flex-end;gap:12px;padding:14px;margin-bottom:14px}.report-filters .field{margin:0;min-width:160px}.report-quick{display:flex;gap:7px;flex-wrap:wrap}.report-tabs{display:flex;gap:8px;overflow:auto;padding:2px 0 14px;margin-bottom:6px}.report-tabs button{border:1px solid var(--line);background:#fff;border-radius:999px;padding:8px 13px;white-space:nowrap;color:var(--muted);font:inherit;cursor:pointer}.report-tabs button.active{background:var(--ink);color:#fff;border-color:var(--ink)}.report-section{margin:8px 0 14px}.report-section h2{margin:0 0 4px}.report-kpis{grid-template-columns:repeat(6,minmax(0,1fr));margin-bottom:16px}.report-grid{margin-bottom:16px}.report-statement h3,.report-note h3{margin:0 0 5px}.report-statement p,.report-note p{margin:0 0 16px;color:var(--muted);font-size:13px;line-height:1.8}.statement-line{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}.statement-line:last-child{border-bottom:0}.statement-line.total{font-weight:700;padding-top:14px}.statement-line .negative{color:var(--neg)}.report-table{padding:6px 0}@media(max-width:1100px){.report-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:700px){.reports-head{align-items:flex-start;flex-direction:column}.report-filters{align-items:stretch;flex-direction:column}.report-filters .field{min-width:0}.report-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.report-grid{grid-template-columns:1fr}}
@media print{.sidebar,.topbar,.bottom-nav,.report-filters,.report-tabs,.reports-head .btn{display:none!important}.main,.content{margin:0!important;padding:0!important}.card{box-shadow:none!important;border:1px solid #ddd!important}.report-section{break-after:avoid}}
`;
