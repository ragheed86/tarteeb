'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getInvoices, getClients, getProjects, createInvoice, getQuotes } from '@/lib/data';
import { fmtMoney, fmtNum, INVOICE_STATUS } from '@/lib/format';
import { Loading, Empty, ErrorBar, Modal, DataTable, Input, Select, Money, DateText, StatusPill } from '@/components';

const VAT_RATE = 15;
const blankItem = () => ({ description: '', qty: 1, unit_price: '' });
function addDaysISO(value, days) {
  const date = value ? new Date(value) : new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export default function InvoicesPage() {
  const router = useRouter();
  const [state, setState] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [head, setHead] = useState({ client_id: '', project_id: '', number: '', issue_at: '', due_at: '', vat_applicable: true, status: 'unpaid' });
  const [items, setItems] = useState([blankItem()]);

  async function load() {
    try {
      const [invoices, clients, projects, quotes] = await Promise.all([getInvoices(), getClients(), getProjects(), getQuotes()]);
      const byId = Object.fromEntries(clients.map((c) => [c.id, c.name]));
      setState({ invoices, clients, projects, quotes, byId });
    } catch (e) { setErr(e.message || 'تعذّر التحميل'); }
  }
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
  useEffect(() => { load(); }, []);

  function openAdd() {
    const issue = new Date().toISOString().slice(0, 10);
    setHead({ client_id: state?.clients[0]?.id || '', project_id: '', number: '', issue_at: issue, due_at: addDaysISO(issue, 14), vat_applicable: true, status: 'unpaid' });
    setItems([blankItem()]); setFormErr(''); setOpen(true);
  }
  function close() { if (!saving) setOpen(false); }
  function setH(k, v) { setHead((h) => ({ ...h, [k]: v })); }
  function setItem(idx, k, v) { setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, [k]: v } : it))); }
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
      const created = await createInvoice(invoice, rows);
      close();
      router.push(`/invoices/${created.id}`);
    } catch (e2) { setFormErr(e2.message || 'تعذّر إنشاء الفاتورة'); setSaving(false); }
  }

  if (err) return <ErrorBar message={err} />;
  if (!state) return <Loading />;

  const { invoices, clients, projects, quotes, byId } = state;
  // عرض سعر مقبول لهذا العميل (الأحدث) — لعرض «استيراد البنود»
  const clientQuote = head.client_id ? (quotes || []).find((qt) => qt.linked_client_id === head.client_id && qt.status === 'accepted') : null;
  const totalPaid = invoices.reduce((s, i) => s + Number(i.paid_amount || 0), 0);
  const totalAll = invoices.reduce((s, i) => s + Number(i.total || 0), 0);
  const totalRemaining = invoices.reduce((s, i) => s + Number(i.remaining_amount || 0), 0);
  const clientProjects = projects.filter((p) => p.client_id === head.client_id);

  return (
    <>
      <div className="sec-head" style={{ marginBottom: 18 }}>
        <button className="btn" onClick={openAdd}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          فاتورة جديدة
        </button>
        <span className="more" style={{ marginInlineStart: 'auto' }}>
          {fmtNum(invoices.length)} فاتورة · محصّل {fmtMoney(totalPaid)} من {fmtMoney(totalAll)} ⃁ · متبقّي {fmtMoney(totalRemaining)} ⃁
        </span>
      </div>
      <div className="card" style={{ padding: '6px 0' }}>
        <DataTable
          rows={invoices}
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
          ]}
          footer={(
            <tr><td colSpan={4}><b>الإجمالي</b></td><td className="amt"><b>{fmtMoney(totalAll)} ⃁</b></td><td className="amt"><b>{fmtMoney(totalPaid)} ⃁</b></td><td className="amt"><b>{fmtMoney(totalRemaining)} ⃁</b></td><td /></tr>
          )}
        />
      </div>

      <Modal
        open={open}
        onClose={close}
        title="فاتورة جديدة"
        subtitle="بنود الفاتورة واحتساب الضريبة تلقائياً"
        as="form"
        onSubmit={submit}
        className="invoice-form-modal"
        footer={(
          <>
            <button className="btn ghost" type="button" onClick={close} disabled={saving}>إلغاء</button>
            <button className="btn" type="submit" disabled={saving}>{saving ? 'جارٍ الإنشاء…' : 'إنشاء الفاتورة'}</button>
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
          <Select label="الحالة" value={head.status} onChange={(e) => setH('status', e.target.value)}
            options={[{ value: 'draft', label: 'مسودة' }, { value: 'unpaid', label: 'غير مدفوعة' }]} />
          <Select label="الضريبة (15%)" value={head.vat_applicable ? '1' : '0'} onChange={(e) => setH('vat_applicable', e.target.value === '1')}
            options={[{ value: '1', label: 'خاضعة للضريبة' }, { value: '0', label: 'معفاة' }]} />
        </div>

            {/* استيراد بنود عرض السعر المقبول لهذا العميل */}
            {clientQuote && (
              <div className="quote-import">
                <span>لهذا العميل عرض سعر مقبول <b dir="ltr">{clientQuote.number}</b> بإجمالي {fmtMoney((clientQuote.items || []).reduce((s, it) => s + ((Number(it.cost) || 0) * (Number(it.days) || 0) - (Number(it.discount) || 0)), 0))} ⃁</span>
                <button type="button" className="btn ghost sm" onClick={() => importQuoteItems(clientQuote)}>⬇ استيراد بنوده</button>
              </div>
            )}

            {/* البنود */}
            <div style={{ marginTop: 6 }}>
              <label className="field" style={{ marginBottom: 8 }}>البنود</label>
              {items.map((it, idx) => (
                <div className="inline-add" key={idx} style={{ marginTop: 8 }}>
                  <input placeholder="الوصف" value={it.description} onChange={(e) => setItem(idx, 'description', e.target.value)} style={{ flex: 2 }} />
                  <input type="number" min="0" step="1" placeholder="الكمية" dir="ltr" style={{ maxWidth: 90 }} value={it.qty} onChange={(e) => setItem(idx, 'qty', e.target.value)} />
                  <input type="number" min="0" step="0.01" placeholder="سعر الوحدة" dir="ltr" style={{ maxWidth: 120 }} value={it.unit_price} onChange={(e) => setItem(idx, 'unit_price', e.target.value)} />
                  <span className="amt" style={{ minWidth: 90, alignSelf: 'center', color: 'var(--muted)' }}>{fmtMoney((Number(it.qty) || 0) * (Number(it.unit_price) || 0))} ⃁</span>
                  <button type="button" className="x-btn" onClick={() => rmItem(idx)}>✕</button>
                </div>
              ))}
              <button type="button" className="btn ghost sm" style={{ marginTop: 10 }} onClick={addItem}>+ بند</button>
            </div>

            {/* المجاميع */}
        <div className="totals">
          <div className="trow"><span>المجموع الفرعي</span><Money v={subtotal} /></div>
          <div className="trow"><span>الضريبة ({head.vat_applicable ? `${VAT_RATE}%` : 'معفاة'})</span><Money v={vatAmount} /></div>
          <div className="trow grand"><span>الإجمالي</span><Money v={total} /></div>
        </div>
      </Modal>
    </>
  );
}
