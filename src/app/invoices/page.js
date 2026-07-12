'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getInvoices, getClients, getProjects, createInvoice, getQuotes, getInvoiceItems, updateInvoiceWithItems, updateInvoice, removeInvoice, getServices } from '@/lib/data';
import { fmtMoney, fmtNum, INVOICE_STATUS } from '@/lib/format';
import { Loading, Empty, ErrorBar, Modal, DataTable, Input, Select, Money, DateText, StatusPill } from '@/components';

const VAT_RATE = 15;
const blankItem = () => ({ description: '', qty: 1, unit_price: '' });
function addDaysISO(value, days) {
  const date = value ? new Date(value) : new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
const isRefunded = (i) => i.status === 'refunded';

export default function InvoicesPage() {
  const router = useRouter();
  const [state, setState] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
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
  const clientQuote = head.client_id ? (quotes || []).find((qt) => qt.linked_client_id === head.client_id && qt.status === 'accepted') : null;
  const clientProjects = projects.filter((p) => p.client_id === head.client_id);

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
        <button className="btn" onClick={openAdd}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          فاتورة جديدة
        </button>
      </div>

      {/* مؤشرات الفواتير */}
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(6,minmax(0,1fr))', marginBottom: 18 }}>
        <div className="kpi"><div className="lbl">إجمالي المفوتر</div><div className="val">{fmtMoney(totalAll)} ⃁</div><div className="trend"><span>{fmtNum(active.length)} فاتورة نشطة</span></div></div>
        <div className="kpi"><div className="lbl">المحصّل</div><div className="val">{fmtMoney(totalPaid)} ⃁</div><div className="trend"><span>نسبة التحصيل {fmtNum(collectRate)}%</span></div></div>
        <div className="kpi"><div className="lbl">المتبقّي</div><div className="val">{fmtMoney(totalRemaining)} ⃁</div><div className="trend"><span>غير محصّل بعد</span></div></div>
        <div className="kpi"><div className="lbl">فواتير متأخرة</div><div className="val">{fmtNum(overdueCount)}</div><div className="trend"><span>تجاوزت الاستحقاق</span></div></div>
        <div className="kpi"><div className="lbl">إجمالي الفواتير</div><div className="val">{fmtNum(invoices.length)}</div><div className="trend"><span>كل الحالات</span></div></div>
        <div className="kpi"><div className="lbl">مرتجعات</div><div className="val">{fmtNum(refunded.length)}</div><div className="trend"><span>{fmtMoney(refundedSum)} ⃁</span></div></div>
      </div>

      <div className="card" style={{ padding: '6px 0' }}>
        <DataTable
          rows={invoices}
          rowClassName={(inv) => (isRefunded(inv) ? 'inv-refunded' : '')}
          onRowClick={(inv) => router.push(`/invoices/${inv.id}`)}
          empty={<Empty title="لا توجد فواتير بعد" desc="أنشئ أول فاتورة لمشروع لتظهر هنا." />}
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
          footer={(
            <tr><td colSpan={4}><b>الإجمالي (النشط)</b></td><td className="amt"><b>{fmtMoney(totalAll)} ⃁</b></td><td className="amt"><b>{fmtMoney(totalPaid)} ⃁</b></td><td className="amt"><b>{fmtMoney(totalRemaining)} ⃁</b></td><td /><td /></tr>
          )}
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
.inv-actions{display:inline-flex;gap:6px;justify-content:flex-end}
.inv-ic{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;border:1px solid var(--line);background:var(--surface,#fff);color:var(--muted);cursor:pointer;transition:.15s}
.inv-ic svg{width:16px;height:16px}
.inv-ic:hover{border-color:var(--green);color:var(--green)}
.inv-ic.danger:hover{border-color:var(--neg,#D0503C);color:var(--neg,#D0503C)}
.inv-ic:disabled{opacity:.4;cursor:not-allowed}
.inv-refunded{opacity:.62}
@media(max-width:768px){
  .inv-actions{justify-content:flex-start}
  .inv-ic{width:40px;height:40px}
}
`;
