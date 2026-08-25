'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getInvoices, getClients, getProjects, createInvoice, getQuotes, getInvoiceItems, updateInvoiceWithItems, updateInvoice, removeInvoice, getServices } from '@/lib/data';
import { fmtMoney, fmtNum, INVOICE_STATUS } from '@/lib/format';
import { Loading, Empty, ErrorBar, Modal, DataTable, Input, Select, Money, DateText, StatusPill, KpiCard } from '@/components';

const VAT_RATE = 15;
const blankItem = () => ({ description: '', qty: 1, unit_price: '' });
function addDaysISO(value, days) {
  const date = value ? new Date(value) : new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
const isRefunded = (i) => i.status === 'refunded';
const ARABIC_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };
function normalizeSearch(value) {
  return String(value ?? '')
    .replace(/[٠-٩۰-۹]/g, (digit) => ARABIC_DIGITS[digit])
    .trim()
    .toLowerCase();
}

export default function InvoicesPage() {
  const router = useRouter();
  const [state, setState] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [formErr, setFormErr] = useState('');
  const [head, setHead] = useState({ client_id: '', project_id: '', number: '', issue_at: '', due_at: '', vat_applicable: true, status: 'unpaid' });
  const [items, setItems] = useState([blankItem()]);
  const [services, setServices] = useState([]); // كتالوج الخدمات لاقتراحات البنود

  async function load() {
    try {
      const [invoices, clients, projects, quotes] = await Promise.all([getInvoices(), getClients(), getProjects(), getQuotes()]);
      const byId = Object.fromEntries(clients.map((c) => [c.id, c.name]));
      setState({ invoices, clients, projects, quotes, byId });
    } catch (e) { setErr(e.message || 'تعذّر التحميل'); }
  }
  useEffect(() => {
    load();
    getServices().then((r) => setServices((r || []).filter((s) => s.active !== false))).catch(() => {});
  }, []);

  // يحوّل بنود عرض السعر إلى بنود فاتورة (svc→الوصف، days→الكمية، ويطوي الخصم في سعر الوحدة)
  function importQuoteItems(quote) {
    const rows = (quote.items || []).map((it) => {
      const cost = Number(it.cost) || 0, days = Number(it.days) || 0, discount = Number(it.discount) || 0;
      if (days > 0) return { description: it.svc || '', qty: days, unit_price: Math.round((cost - discount / days) * 100) / 100 };
      return { description: it.svc || '', qty: 1, unit_price: cost - discount };
    });
    setItems(rows.length ? rows : [blankItem()]);
    setFormErr('');
  }

  function openAdd() {
    const issue = new Date().toISOString().slice(0, 10);
    setEditId(null);
    setHead({ client_id: state?.clients[0]?.id || '', project_id: '', number: '', issue_at: issue, due_at: addDaysISO(issue, 14), vat_applicable: true, status: 'unpaid' });
    setItems([blankItem()]); setFormErr(''); setOpen(true);
  }
  async function openEdit(inv, e) {
    e.stopPropagation();
    setFormErr('');
    try {
      const its = await getInvoiceItems(inv.id);
      setEditId(inv.id);
      setHead({
        client_id: inv.client_id || '', project_id: inv.project_id || '', number: inv.number || '',
        issue_at: inv.issue_at ? inv.issue_at.slice(0, 10) : '', due_at: inv.due_at || '',
        vat_applicable: inv.vat_applicable, status: inv.status,
      });
      setItems(its.length ? its.map((x) => ({ description: x.description, qty: x.qty, unit_price: x.unit_price })) : [blankItem()]);
      setOpen(true);
    } catch { setErr('تعذّر فتح الفاتورة للتعديل'); }
  }
  async function del(inv, e) {
    e.stopPropagation();
    if (!confirm(`حذف الفاتورة ${inv.number || ''}؟ سيُحذف معها بنودها ومدفوعاتها ولا يمكن التراجع.`)) return;
    setBusyId(inv.id);
    try { await removeInvoice(inv.id); await load(); } catch { alert('تعذّر الحذف'); }
    setBusyId(null);
  }
  async function refund(inv, e) {
    e.stopPropagation();
    if (isRefunded(inv)) return;
    if (!confirm(`تسجيل الفاتورة ${inv.number || ''} كمرتجعة؟ ستُستبعد من الإيرادات والمبالغ المحصّلة.`)) return;
    setBusyId(inv.id);
    try { await updateInvoice(inv.id, { status: 'refunded' }); await load(); } catch { alert('تعذّر تسجيل المرتجع'); }
    setBusyId(null);
  }
  function close() { if (!saving) setOpen(false); }
  function setH(k, v) { setHead((h) => ({ ...h, [k]: v })); }
  function setItem(idx, k, v) { setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, [k]: v } : it))); }
  // كتابة وصف البند: إن طابق اسم خدمة من الكتالوج يُعبَّأ سعر الوحدة تلقائياً
  function setDesc(idx, val) {
    const svc = services.find((x) => x.name === val);
    setItems((arr) => arr.map((it, i) => (i !== idx ? it : (svc ? { ...it, description: val, unit_price: Number(svc.default_rate) || 0 } : { ...it, description: val }))));
  }
  function addItem() { setItems((arr) => [...arr, blankItem()]); }
  function rmItem(idx) { setItems((arr) => (arr.length > 1 ? arr.filter((_, i) => i !== idx) : arr)); }

  const subtotal = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0);
  const vatAmount = head.vat_applicable ? subtotal * (VAT_RATE / 100) : 0;
  const total = subtotal + vatAmount;

  async function submit(e) {
    e.preventDefault();
    if (!head.client_id) { setFormErr('اختر العميل'); return; }
    const validItems = items.filter((it) => it.description.trim() && Number(it.unit_price) > 0);
    if (validItems.length === 0) { setFormErr('أضف بنداً واحداً على الأقل بوصف وسعر'); return; }
    setSaving(true); setFormErr('');
    const invoice = {
      number: head.number.trim() || null,
      client_id: head.client_id,
      project_id: head.project_id || null,
      issue_at: head.issue_at ? new Date(head.issue_at).toISOString() : new Date().toISOString(),
      due_at: head.due_at || null,
      subtotal, vat_applicable: head.vat_applicable, vat_rate: VAT_RATE, vat_amount: vatAmount, total,
      status: head.status,
    };
    const rows = validItems.map((it) => ({ description: it.description.trim(), qty: Number(it.qty) || 1, unit_price: Number(it.unit_price) || 0 }));
    try {
      if (editId) {
        await updateInvoiceWithItems(editId, invoice, rows);
        close(); setSaving(false); await load();
      } else {
        const created = await createInvoice(invoice, rows);
        close();
        router.push(`/invoices/${created.id}`);
      }
    } catch (e2) { setFormErr(e2.message || 'تعذّر حفظ الفاتورة'); setSaving(false); }
  }

  if (err) return <ErrorBar message={err} />;
  if (!state) return <Loading />;

  const { invoices, clients, projects, quotes, byId } = state;
  const projectById = Object.fromEntries(projects.map((project) => [project.id, project.title]));
  const clientQuote = head.client_id ? (quotes || []).find((qt) => qt.linked_client_id === head.client_id && qt.status === 'accepted') : null;
  const clientProjects = projects.filter((p) => p.client_id === head.client_id);

  const term = normalizeSearch(query);
  const filteredInvoices = invoices.filter((invoice) => {
    if (statusFilter !== 'all' && invoice.status !== statusFilter) return false;
    const issueDate = invoice.issue_at ? invoice.issue_at.slice(0, 10) : '';
    if (dateFrom && (!issueDate || issueDate < dateFrom)) return false;
    if (dateTo && (!issueDate || issueDate > dateTo)) return false;
    if (!term) return true;
    const statusLabel = INVOICE_STATUS[invoice.status]?.label || invoice.status;
    return [
      invoice.number,
      byId[invoice.client_id],
      projectById[invoice.project_id],
      statusLabel,
      invoice.issue_at,
      invoice.due_at,
      invoice.total,
      invoice.paid_amount,
      invoice.remaining_amount,
    ].some((value) => normalizeSearch(value).includes(term));
  });
  const filtersActive = Boolean(term || statusFilter !== 'all' || dateFrom || dateTo);

  // تغطية الفوترة: مقارنة العملاء والمشاريع بالفواتير المرتبطة فعلياً.
  const invoiceCountByClient = invoices.reduce((counts, invoice) => {
    if (invoice.client_id) counts[invoice.client_id] = (counts[invoice.client_id] || 0) + 1;
    return counts;
  }, {});
  const invoicedProjectIds = new Set(invoices.map((invoice) => invoice.project_id).filter(Boolean));
  const projectsByClient = projects.reduce((groups, project) => {
    if (!groups[project.client_id]) groups[project.client_id] = [];
    groups[project.client_id].push(project);
    return groups;
  }, {});
  const billingCoverage = clients.map((client) => {
    const clientProjectRows = projectsByClient[client.id] || [];
    const uninvoicedProjects = clientProjectRows.filter((project) => !invoicedProjectIds.has(project.id));
    return {
      ...client,
      invoice_count: invoiceCountByClient[client.id] || 0,
      project_count: clientProjectRows.length,
      uninvoiced_projects: uninvoicedProjects,
    };
  }).sort((a, b) => b.uninvoiced_projects.length - a.uninvoiced_projects.length || a.invoice_count - b.invoice_count || a.name.localeCompare(b.name, 'ar'));
  const clientsWithoutInvoices = billingCoverage.filter((client) => client.invoice_count === 0);
  const projectsWithoutInvoices = projects.filter((project) => !invoicedProjectIds.has(project.id));
  const clientsWithInvoices = clients.length - clientsWithoutInvoices.length;

  // مؤشرات: المرتجعات تُستبعد من الأرقام النشطة وتُعرض على حدة
  const active = invoices.filter((i) => !isRefunded(i));
  const refunded = invoices.filter(isRefunded);
  const totalAll = active.reduce((s, i) => s + Number(i.total || 0), 0);
  const totalPaid = active.reduce((s, i) => s + Number(i.paid_amount || 0), 0);
  const totalRemaining = active.reduce((s, i) => s + Number(i.remaining_amount || 0), 0);
  const overdueCount = active.filter((i) => i.status === 'overdue').length;
  const refundedSum = refunded.reduce((s, i) => s + Number(i.total || 0), 0);
  const collectRate = totalAll > 0 ? Math.round((totalPaid / totalAll) * 100) : 0;

  const editing = Boolean(editId);

  return (
    <>
      <style>{CSS}</style>

      <div className="sec-head" style={{ marginBottom: 16 }}>
        <h2 style={{ marginInlineEnd: 'auto' }}>الفواتير</h2>
        <div className="invoice-search" role="search">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input
            aria-label="البحث في الفواتير"
            placeholder="رقم، عميل، مشروع، مبلغ…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select className="filter-sel invoice-status-filter" aria-label="تصفية الفواتير حسب الحالة" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">كل الحالات</option>
          {Object.entries(INVOICE_STATUS).map(([value, status]) => <option key={value} value={value}>{status.label}</option>)}
        </select>
        <button className="btn" onClick={openAdd}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          فاتورة جديدة
        </button>
      </div>

      <div className="invoice-date-filters" aria-label="تصفية الفواتير حسب تاريخ الإصدار">
        <label>من <input className="fdate" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label>إلى <input className="fdate" type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} /></label>
        <span className="invoice-result-count">{fmtNum(filteredInvoices.length)} من {fmtNum(invoices.length)} فاتورة</span>
        {filtersActive && <button type="button" className="btn ghost sm" onClick={() => { setQuery(''); setStatusFilter('all'); setDateFrom(''); setDateTo(''); }}>مسح البحث</button>}
      </div>

      {/* مؤشرات الفواتير */}
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(6,minmax(0,1fr))', marginBottom: 18 }}>
        <KpiCard label="إجمالي المفوتر" value={`${fmtMoney(totalAll)} ⃁`} trend={`${fmtNum(active.length)} فاتورة نشطة`} definition="مجموع القيم النهائية لكل الفواتير غير المرتجعة." period="جميع الفواتير" formula="جمع إجمالي الفواتير النشطة" breakdown={[{ label: 'عدد الفواتير النشطة', value: fmtNum(active.length) }, { label: 'إجمالي المفوتر', value: `${fmtMoney(totalAll)} ⃁` }]} />
        <KpiCard label="المحصّل" value={`${fmtMoney(totalPaid)} ⃁`} trend={`نسبة التحصيل ${fmtNum(collectRate)}%`} definition="مجموع جميع الدفعات المسجلة على الفواتير غير المرتجعة." period="جميع الفواتير" formula="جمع المبالغ المحصّلة" breakdown={[{ label: 'إجمالي المفوتر', value: `${fmtMoney(totalAll)} ⃁` }, { label: 'المحصّل', value: `${fmtMoney(totalPaid)} ⃁` }, { label: 'نسبة التحصيل', value: `${fmtNum(collectRate)}%` }]} />
        <KpiCard label="المتبقّي" value={`${fmtMoney(totalRemaining)} ⃁`} trend="غير محصّل بعد" definition="إجمالي الأرصدة المتبقية على الفواتير غير المرتجعة." period="الحالة الحالية" formula="إجمالي المفوتر − إجمالي المحصّل" breakdown={[{ label: 'إجمالي المفوتر', value: `${fmtMoney(totalAll)} ⃁` }, { label: 'المحصّل', value: `− ${fmtMoney(totalPaid)} ⃁` }, { label: 'المتبقّي', value: `${fmtMoney(totalRemaining)} ⃁` }]} />
        <KpiCard label="فواتير متأخرة" value={fmtNum(overdueCount)} trend="تجاوزت الاستحقاق" definition="فواتير نشطة تجاوز تاريخ استحقاقها وما زالت مصنفة كمتأخرة." period="الحالة الحالية" formula="عدّ الفواتير بالحالة «متأخرة»" breakdown={active.filter((i) => i.status === 'overdue').slice(0, 5).map((i) => ({ label: i.number || 'بلا رقم', value: `${fmtMoney(i.remaining_amount)} ⃁` }))} />
        <KpiCard label="إجمالي الفواتير" value={fmtNum(invoices.length)} trend="كل الحالات" definition="عدد جميع الفواتير المسجلة، بما فيها المسودات والمدفوعة والمتأخرة والمرتجعة." period="كل البيانات المسجلة" formula="عدّ جميع سجلات الفواتير" breakdown={[{ label: 'نشطة وغير مرتجعة', value: fmtNum(active.length) }, { label: 'مرتجعة', value: fmtNum(refunded.length) }]} />
        <KpiCard label="مرتجعات" value={fmtNum(refunded.length)} trend={`${fmtMoney(refundedSum)} ⃁`} definition="عدد الفواتير التي سُجلت كمرتجعة واستُبعدت من مؤشرات التحصيل النشطة." period="كل البيانات المسجلة" formula="عدّ الفواتير بالحالة «مرتجعة»" breakdown={[{ label: 'عدد المرتجعات', value: fmtNum(refunded.length) }, { label: 'قيمتها الإجمالية', value: `${fmtMoney(refundedSum)} ⃁` }]} />
      </div>

      <section className="billing-coverage card" aria-labelledby="billing-coverage-title">
        <div className="billing-coverage-head">
          <div>
            <h2 id="billing-coverage-title">تغطية الفوترة للعملاء والمشاريع</h2>
            <p>مقارنة مباشرة بين أسماء العملاء ومشاريعهم والفواتير الصادرة لهم.</p>
          </div>
          <div className="billing-coverage-totals">
            <span><b>{fmtNum(clients.length)}</b> إجمالي العملاء</span>
            <span className="ok"><b>{fmtNum(clientsWithInvoices)}</b> لديهم فواتير</span>
            <span className={clientsWithoutInvoices.length ? 'warn' : 'ok'}><b>{fmtNum(clientsWithoutInvoices.length)}</b> بلا فواتير</span>
            <span className={projectsWithoutInvoices.length ? 'warn' : 'ok'}><b>{fmtNum(projectsWithoutInvoices.length)}</b> مشروع بلا فاتورة</span>
          </div>
        </div>
        <DataTable
          rows={billingCoverage}
          pageSize={20}
          empty={<Empty title="لا يوجد عملاء" desc="ستظهر مقارنة الفوترة بعد إضافة العملاء." />}
          columns={[
            { key: 'name', label: 'العميل', primary: true, render: (client) => <span className="nm">{client.name}</span> },
            { key: 'project_count', label: 'عدد المشاريع', align: 'center', render: (client) => <span className="amt">{fmtNum(client.project_count)}</span> },
            { key: 'invoice_count', label: 'عدد الفواتير', align: 'center', render: (client) => <span className={`coverage-count ${client.invoice_count === 0 ? 'missing' : ''}`}>{fmtNum(client.invoice_count)}</span> },
            {
              key: 'uninvoiced_projects', label: 'مشاريع بلا فاتورة',
              render: (client) => client.uninvoiced_projects.length ? (
                <div className="coverage-projects">
                  {client.uninvoiced_projects.map((project) => <span key={project.id}>{project.title}</span>)}
                </div>
              ) : <span className="coverage-complete">مكتملة الفوترة</span>,
            },
          ]}
        />
      </section>

      <div className="card" style={{ padding: '6px 0' }}>
        <DataTable
          rows={filteredInvoices}
          rowClassName={(inv) => (isRefunded(inv) ? 'inv-refunded' : '')}
          onRowClick={(inv) => router.push(`/invoices/${inv.id}`)}
          empty={filtersActive
            ? <Empty title="لا توجد نتائج" desc="جرّب تغيير عبارة البحث أو الحالة أو نطاق التاريخ." />
            : <Empty title="لا توجد فواتير بعد" desc="أنشئ أول فاتورة لمشروع لتظهر هنا." />}
          columns={[
            { key: 'number', label: 'رقم الفاتورة', primary: true, render: (inv) => <span className="nm amt" dir="ltr">{inv.number || '—'}</span> },
            { key: 'client', label: 'العميل', render: (inv) => byId[inv.client_id] || '—' },
            { key: 'issue_at', label: 'الإصدار', render: (inv) => <DateText v={inv.issue_at} /> },
            { key: 'due_at', label: 'الاستحقاق', render: (inv) => <DateText v={inv.due_at} /> },
            { key: 'total', label: 'الإجمالي', render: (inv) => <Money v={inv.total} /> },
            { key: 'paid_amount', label: 'المحصّل', render: (inv) => <Money v={inv.paid_amount} /> },
            { key: 'remaining_amount', label: 'المتبقي', render: (inv) => <Money v={inv.remaining_amount} /> },
            { key: 'status', label: 'الحالة', render: (inv) => <StatusPill status={inv.status} map={INVOICE_STATUS} /> },
            { key: 'actions', label: 'إجراءات', render: (inv) => (
              <div className="inv-actions" onClick={(e) => e.stopPropagation()}>
                <button className="inv-ic" title="تعديل" aria-label="تعديل" disabled={busyId === inv.id} onClick={(e) => openEdit(inv, e)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                </button>
                <button className="inv-ic" title="مرتجع" aria-label="تسجيل مرتجع" disabled={busyId === inv.id || isRefunded(inv)} onClick={(e) => refund(inv, e)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 5 5v1" /></svg>
                </button>
                <button className="inv-ic danger" title="حذف" aria-label="حذف" disabled={busyId === inv.id} onClick={(e) => del(inv, e)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                </button>
              </div>
            ) },
          ]}
          footer={filteredInvoices.length > 0 ? (() => {
            const shown = filteredInvoices.filter((invoice) => !isRefunded(invoice));
            return <tr><td colSpan={4}><b>إجمالي النتائج النشطة</b></td><td className="amt"><b>{fmtMoney(shown.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0))} ⃁</b></td><td className="amt"><b>{fmtMoney(shown.reduce((sum, invoice) => sum + Number(invoice.paid_amount || 0), 0))} ⃁</b></td><td className="amt"><b>{fmtMoney(shown.reduce((sum, invoice) => sum + Number(invoice.remaining_amount || 0), 0))} ⃁</b></td><td /><td /></tr>;
          })() : null}
        />
      </div>

      <Modal
        open={open}
        onClose={close}
        title={editing ? 'تعديل الفاتورة' : 'فاتورة جديدة'}
        subtitle="بنود الفاتورة واحتساب الضريبة تلقائياً"
        as="form"
        onSubmit={submit}
        className="invoice-form-modal"
        footer={(
          <>
            <button className="btn ghost" type="button" onClick={close} disabled={saving}>إلغاء</button>
            <button className="btn" type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : (editing ? 'حفظ التعديلات' : 'إنشاء الفاتورة')}</button>
          </>
        )}
      >
        {formErr && <div className="errbar">{formErr}</div>}
        <div className="form-grid">
          <Select label="العميل" value={head.client_id} onChange={(e) => { setH('client_id', e.target.value); setH('project_id', ''); }} required>
            <option value="" disabled>اختر عميلاً…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select label="المشروع (اختياري)" value={head.project_id} onChange={(e) => setH('project_id', e.target.value)}>
            <option value="">— بدون —</option>
            {clientProjects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </Select>
          <Input label="رقم الفاتورة (اختياري)" ltr value={head.number} onChange={(e) => setH('number', e.target.value)} placeholder="يولّد تلقائياً" />
          <Input label="تاريخ الإصدار" ltr type="date" value={head.issue_at} onChange={(e) => { setH('issue_at', e.target.value); setH('due_at', addDaysISO(e.target.value, 14)); }} />
          <Input label="تاريخ الاستحقاق" ltr type="date" value={head.due_at} onChange={(e) => setH('due_at', e.target.value)} />
          {!editing && (
            <Select label="الحالة" value={head.status} onChange={(e) => setH('status', e.target.value)}
              options={[{ value: 'draft', label: 'مسودة' }, { value: 'unpaid', label: 'غير مدفوعة' }]} />
          )}
          <Select label="الضريبة (15%)" value={head.vat_applicable ? '1' : '0'} onChange={(e) => setH('vat_applicable', e.target.value === '1')}
            options={[{ value: '1', label: 'خاضعة للضريبة' }, { value: '0', label: 'معفاة' }]} />
        </div>

        {clientQuote && !editing && (
          <div className="quote-import">
            <span>لهذا العميل عرض سعر مقبول <b dir="ltr">{clientQuote.number}</b> بإجمالي {fmtMoney((clientQuote.items || []).reduce((s, it) => s + ((Number(it.cost) || 0) * (Number(it.days) || 0) - (Number(it.discount) || 0)), 0))} ⃁</span>
            <button type="button" className="btn ghost sm" onClick={() => importQuoteItems(clientQuote)}>⬇ استيراد بنوده</button>
          </div>
        )}

        <div style={{ marginTop: 6 }}>
          <label className="field" style={{ marginBottom: 8 }}>البنود</label>
          {items.map((it, idx) => (
            <div className="inline-add" key={idx} style={{ marginTop: 8 }}>
              <input list="inv-svclist" placeholder="الوصف" value={it.description} onChange={(e) => setDesc(idx, e.target.value)} style={{ flex: 2 }} />
              <input type="number" min="0" step="1" placeholder="الكمية" dir="ltr" style={{ maxWidth: 90 }} value={it.qty} onChange={(e) => setItem(idx, 'qty', e.target.value)} />
              <input type="number" min="0" step="0.01" placeholder="سعر الوحدة" dir="ltr" style={{ maxWidth: 120 }} value={it.unit_price} onChange={(e) => setItem(idx, 'unit_price', e.target.value)} />
              <span className="amt" style={{ minWidth: 90, alignSelf: 'center', color: 'var(--muted)' }}>{fmtMoney((Number(it.qty) || 0) * (Number(it.unit_price) || 0))} ⃁</span>
              <button type="button" className="x-btn" onClick={() => rmItem(idx)} aria-label="حذف البند">✕</button>
            </div>
          ))}
          <button type="button" className="btn ghost sm" style={{ marginTop: 10 }} onClick={addItem}>+ بند</button>
          {services.length > 0 && (
            <datalist id="inv-svclist">{services.map((s) => <option key={s.id} value={s.name} />)}</datalist>
          )}
        </div>

        <div className="totals">
          <div className="trow"><span>المجموع الفرعي</span><Money v={subtotal} /></div>
          <div className="trow"><span>الضريبة ({head.vat_applicable ? `${VAT_RATE}%` : 'معفاة'})</span><Money v={vatAmount} /></div>
          <div className="trow grand"><span>الإجمالي</span><Money v={total} /></div>
        </div>
      </Modal>
    </>
  );
}

const CSS = `
.invoice-search{display:flex;align-items:center;gap:9px;width:min(320px,30vw);min-width:220px;border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:9px 12px;color:var(--faint)}
.invoice-search:focus-within{border-color:var(--teal-500);box-shadow:var(--focus-ring)}
.invoice-search input{width:100%;min-width:0;border:0;outline:0;background:none;color:var(--ink);font:inherit}
.invoice-status-filter{min-width:140px}
.invoice-date-filters{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:-4px 0 16px}
.invoice-date-filters label{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:13px}
.invoice-date-filters .fdate{min-width:145px}
.invoice-result-count{color:var(--muted);font-size:13px;margin-inline-start:auto}
.billing-coverage{padding:0;margin-bottom:18px;overflow:hidden}
.billing-coverage-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:18px 20px;border-bottom:1px solid var(--line)}
.billing-coverage-head h2{font-family:var(--display);font-size:17px;margin:0 0 4px}
.billing-coverage-head p{color:var(--muted);font-size:13px;margin:0}
.billing-coverage-totals{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.billing-coverage-totals span{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);border-radius:999px;background:var(--surface-2);padding:7px 10px;color:var(--muted);font-size:12.5px;white-space:nowrap}
.billing-coverage-totals span.ok{color:var(--green);border-color:color-mix(in srgb,var(--green) 25%,var(--line))}
.billing-coverage-totals span.warn{color:var(--neg);border-color:color-mix(in srgb,var(--neg) 25%,var(--line))}
.coverage-count{display:inline-flex;min-width:30px;height:30px;align-items:center;justify-content:center;border-radius:9px;background:var(--surface-2);font-variant-numeric:tabular-nums}
.coverage-count.missing{background:color-mix(in srgb,var(--neg) 10%,white);color:var(--neg);font-weight:700}
.coverage-projects{display:flex;gap:6px;flex-wrap:wrap}
.coverage-projects span{border-radius:999px;background:color-mix(in srgb,var(--gold) 12%,white);color:#8a4e12;border:1px solid color-mix(in srgb,var(--gold) 28%,var(--line));padding:4px 8px;font-size:12px}
.coverage-complete{color:var(--green);font-size:12.5px;font-weight:600}
.inv-actions{display:inline-flex;gap:6px;justify-content:flex-end}
.inv-ic{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;border:1px solid var(--line);background:var(--surface,#fff);color:var(--muted);cursor:pointer;transition:.15s}
.inv-ic svg{width:16px;height:16px}
.inv-ic:hover{border-color:var(--green);color:var(--green)}
.inv-ic.danger:hover{border-color:var(--neg,#D0503C);color:var(--neg,#D0503C)}
.inv-ic:disabled{opacity:.4;cursor:not-allowed}
.inv-refunded{opacity:.62}
@media(max-width:768px){
  .invoice-search{order:1;width:100%;min-width:0;min-height:48px}
  .invoice-status-filter{order:1;width:100%;min-height:48px;font-size:16px}
  .invoice-date-filters{display:grid;grid-template-columns:1fr 1fr;align-items:end}
  .invoice-date-filters label{display:grid;gap:5px}
  .invoice-date-filters .fdate{width:100%;min-width:0}
  .invoice-result-count{grid-column:1 / -1;margin:0;text-align:center}
  .invoice-date-filters .btn{grid-column:1 / -1;justify-content:center}
  .billing-coverage-head{flex-direction:column;align-items:stretch;padding:16px}
  .billing-coverage-totals{display:grid;grid-template-columns:1fr 1fr;justify-content:stretch}
  .billing-coverage-totals span{justify-content:center;text-align:center;white-space:normal}
  .inv-actions{justify-content:flex-start}
  .inv-ic{width:40px;height:40px}
}
`;
