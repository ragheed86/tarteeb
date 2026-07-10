'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getInvoices, getClients, getProjects, createInvoice, getQuotes } from '@/lib/data';
import { fmtMoney, fmtNum, fmtDate, INVOICE_STATUS } from '@/lib/format';
import { Loading, Empty, ErrorBar } from '../ui';

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
        {invoices.length === 0 ? (
          <Empty title="لا توجد فواتير بعد" desc="أنشئ أول فاتورة لمشروع لتظهر هنا." />
        ) : (
          <table>
            <thead><tr><th>رقم الفاتورة</th><th>العميل</th><th>الإصدار</th><th>الاستحقاق</th><th>الإجمالي</th><th>المحصّل</th><th>المتبقي</th><th>الحالة</th></tr></thead>
            <tbody>
              {invoices.map((inv) => {
                const st = INVOICE_STATUS[inv.status] || { label: inv.status, cls: 'p-wait' };
                return (
                  <tr key={inv.id} className="clickable" onClick={() => router.push(`/invoices/${inv.id}`)}>
                    <td><span className="nm amt">{inv.number || '—'}</span></td>
                    <td>{byId[inv.client_id] || '—'}</td>
                    <td>{fmtDate(inv.issue_at)}</td>
                    <td>{fmtDate(inv.due_at)}</td>
                    <td className="amt">{fmtMoney(inv.total)} ⃁</td>
                    <td className="amt">{fmtMoney(inv.paid_amount)} ⃁</td>
                    <td className="amt">{fmtMoney(inv.remaining_amount)} ⃁</td>
                    <td><span className={`pill ${st.cls}`}>{st.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td colSpan={4}><b>الإجمالي</b></td><td className="amt"><b>{fmtMoney(totalAll)} ⃁</b></td><td className="amt"><b>{fmtMoney(totalPaid)} ⃁</b></td><td className="amt"><b>{fmtMoney(totalRemaining)} ⃁</b></td><td /></tr>
            </tfoot>
          </table>
        )}
      </div>

      {open && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <form className="modal-card" onSubmit={submit} style={{ width: 'min(820px,100%)' }}>
            <div className="modal-head">
              <div><h2>فاتورة جديدة</h2><p>بنود الفاتورة واحتساب الضريبة تلقائياً</p></div>
              <button className="icon-close" type="button" onClick={close} aria-label="إغلاق">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            {formErr && <div className="errbar">{formErr}</div>}
            <div className="form-grid">
              <div className="field"><label>العميل</label>
                <select value={head.client_id} onChange={(e) => { setH('client_id', e.target.value); setH('project_id', ''); }} required>
                  <option value="" disabled>اختر عميلاً…</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="field"><label>المشروع (اختياري)</label>
                <select value={head.project_id} onChange={(e) => setH('project_id', e.target.value)}>
                  <option value="">— بدون —</option>
                  {clientProjects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </div>
              <div className="field"><label>رقم الفاتورة (اختياري)</label><input value={head.number} onChange={(e) => setH('number', e.target.value)} placeholder="يولّد تلقائياً" dir="ltr" /></div>
              <div className="field"><label>تاريخ الإصدار</label><input type="date" value={head.issue_at} onChange={(e) => { setH('issue_at', e.target.value); setH('due_at', addDaysISO(e.target.value, 14)); }} dir="ltr" /></div>
              <div className="field"><label>تاريخ الاستحقاق</label><input type="date" value={head.due_at} onChange={(e) => setH('due_at', e.target.value)} dir="ltr" /></div>
              <div className="field"><label>الحالة</label>
                <select value={head.status} onChange={(e) => setH('status', e.target.value)}>
                  <option value="draft">مسودة</option>
                  <option value="unpaid">غير مدفوعة</option>
                </select>
              </div>
              <div className="field"><label>الضريبة (15%)</label>
                <select value={head.vat_applicable ? '1' : '0'} onChange={(e) => setH('vat_applicable', e.target.value === '1')}>
                  <option value="1">خاضعة للضريبة</option>
                  <option value="0">معفاة</option>
                </select>
              </div>
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
              <div className="trow"><span>المجموع الفرعي</span><span className="amt">{fmtMoney(subtotal)} ⃁</span></div>
              <div className="trow"><span>الضريبة ({head.vat_applicable ? `${VAT_RATE}%` : 'معفاة'})</span><span className="amt">{fmtMoney(vatAmount)} ⃁</span></div>
              <div className="trow grand"><span>الإجمالي</span><span className="amt">{fmtMoney(total)} ⃁</span></div>
            </div>

            <div className="modal-actions">
              <button className="btn ghost" type="button" onClick={close} disabled={saving}>إلغاء</button>
              <button className="btn" type="submit" disabled={saving}>{saving ? 'جارٍ الإنشاء…' : 'إنشاء الفاتورة'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
