'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  getInvoice, getInvoiceItems, getInvoicePayments, getClient, getCompanySettings,
  updateInvoice, createInvoicePayment, removeInvoicePayment,
} from '@/lib/data';
import { fmtMoney, fmtNum, fmtDate, INVOICE_STATUS } from '@/lib/format';
import { Loading, Empty, ErrorBar } from '../../ui';

const STATUS_OPTS = [
  { value: 'draft', label: 'مسودة' },
  { value: 'unpaid', label: 'غير مدفوعة' },
  { value: 'partial', label: 'مدفوعة جزئياً' },
  { value: 'paid', label: 'مدفوعة' },
  { value: 'overdue', label: 'متأخرة' },
];
const PAYMENT_METHOD = {
  cash: 'نقداً',
  bank_transfer: 'تحويل بنكي',
  card: 'بطاقة',
  mada: 'مدى',
  stc_pay: 'STC Pay',
  other: 'أخرى',
};

// رقم واتساب دولي من رقم سعودي محلي
function waLink(phone, text) {
  if (!phone) return null;
  let p = String(phone).replace(/\D/g, '');
  if (p.startsWith('0')) p = '966' + p.slice(1);
  else if (!p.startsWith('966')) p = '966' + p;
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}

export default function InvoiceDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [payment, setPayment] = useState({ amount: '', paid_at: new Date().toISOString().slice(0, 10), method: 'bank_transfer', note: '' });
  const [paymentErr, setPaymentErr] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);

  async function load() {
    setErr('');
    try {
      const invoice = await getInvoice(id);
      const [items, payments, client, company] = await Promise.all([
        getInvoiceItems(id),
        getInvoicePayments(id),
        invoice.client_id ? getClient(invoice.client_id) : Promise.resolve(null),
        getCompanySettings().catch(() => null),
      ]);
      setD({ invoice, items, payments, client, company });
      setPayment((p) => ({ ...p, amount: Number(invoice.remaining_amount || 0) > 0 ? String(invoice.remaining_amount) : '' }));
    } catch (e) { setErr(e.message || 'تعذّر تحميل الفاتورة'); }
  }
  useEffect(() => { load(); }, [id]);

  async function changeStatus(status) {
    setBusy(true);
    try { const up = await updateInvoice(id, { status }); setD((s) => ({ ...s, invoice: up })); }
    catch (e) { setErr(e.message || 'تعذّر التحديث'); }
    finally { setBusy(false); }
  }
  async function changeDueAt(dueAt) {
    setBusy(true);
    try { const up = await updateInvoice(id, { due_at: dueAt || null }); setD((s) => ({ ...s, invoice: up })); }
    catch (e) { setErr(e.message || 'تعذّر تحديث تاريخ الاستحقاق'); }
    finally { setBusy(false); }
  }
  async function addPayment(e) {
    e.preventDefault();
    const amount = Number(payment.amount) || 0;
    if (amount <= 0) { setPaymentErr('أدخل مبلغ دفعة صحيح'); return; }
    setSavingPayment(true); setPaymentErr('');
    try {
      await createInvoicePayment({
        invoice_id: id,
        amount,
        paid_at: payment.paid_at ? new Date(payment.paid_at).toISOString() : new Date().toISOString(),
        method: payment.method,
        note: payment.note,
      });
      const [invoice, payments] = await Promise.all([getInvoice(id), getInvoicePayments(id)]);
      setD((s) => ({ ...s, invoice, payments }));
      setPayment({ amount: Number(invoice.remaining_amount || 0) > 0 ? String(invoice.remaining_amount) : '', paid_at: new Date().toISOString().slice(0, 10), method: 'bank_transfer', note: '' });
    } catch (e2) {
      setPaymentErr(e2.message || 'تعذّر تسجيل الدفعة');
    } finally {
      setSavingPayment(false);
    }
  }
  async function deletePayment(row) {
    if (!confirm('حذف هذه الدفعة؟ ستُعاد حسابات الفاتورة تلقائياً.')) return;
    setSavingPayment(true); setPaymentErr('');
    try {
      await removeInvoicePayment(row.id);
      const [invoice, payments] = await Promise.all([getInvoice(id), getInvoicePayments(id)]);
      setD((s) => ({ ...s, invoice, payments }));
      setPayment((p) => ({ ...p, amount: Number(invoice.remaining_amount || 0) > 0 ? String(invoice.remaining_amount) : '' }));
    } catch (e2) {
      setPaymentErr(e2.message || 'تعذّر حذف الدفعة');
    } finally {
      setSavingPayment(false);
    }
  }

  if (err) return <ErrorBar message={err} />;
  if (!d) return <Loading />;

  const { invoice, items, payments, client, company } = d;
  if (!invoice) return <Empty title="غير موجودة" desc="لم يُعثر على هذه الفاتورة." />;
  const st = INVOICE_STATUS[invoice.status] || { label: invoice.status, cls: 'p-wait' };
  const wa = waLink(client?.phone, `فاتورة ${invoice.number} من ${company?.name_ar || 'ترتيب'} بقيمة ${fmtMoney(invoice.total)} ⃁`);
  const paidAmount = Number(invoice.paid_amount || 0);
  const remainingAmount = Number(invoice.remaining_amount || 0);

  return (
    <>
      {/* شريط أدوات (يُخفى عند الطباعة) */}
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="back-link" style={{ margin: 0 }} onClick={() => router.push('/invoices')}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          رجوع
        </button>
        <span style={{ marginInlineStart: 'auto' }} />
        <select className="filter-sel" value={invoice.status} disabled={busy} onChange={(e) => changeStatus(e.target.value)}>
          {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {wa && <a className="btn ghost sm" href={wa} target="_blank" rel="noreferrer">إرسال واتساب</a>}
        <button className="btn sm" onClick={() => window.print()}>طباعة</button>
      </div>

      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <div className="kpi"><div className="lbl">إجمالي الفاتورة</div><div className="val amt">{fmtMoney(invoice.total)} ⃁</div></div>
        <div className="kpi"><div className="lbl">المحصّل</div><div className="val amt">{fmtMoney(paidAmount)} ⃁</div></div>
        <div className="kpi"><div className="lbl">المتبقي</div><div className="val amt">{fmtMoney(remainingAmount)} ⃁</div></div>
        <div className="kpi"><div className="lbl">عدد الدفعات</div><div className="val amt">{fmtNum(payments.length)}</div></div>
      </div>

      {/* ورقة الفاتورة */}
      <div className="card invoice-sheet">
        <div className="inv-top">
          <div>
            <h1 className="inv-co">{company?.name_ar || 'ترتيب لتنظيم المساحات'}</h1>
            {company?.vat_number && <div className="inv-meta">الرقم الضريبي: <span className="amt" dir="ltr">{company.vat_number}</span></div>}
            {company?.cr_number && <div className="inv-meta">السجل التجاري: <span className="amt" dir="ltr">{company.cr_number}</span></div>}
            {company?.city && <div className="inv-meta">{company.city}{company.phone ? ` · ${company.phone}` : ''}</div>}
          </div>
          <div className="inv-title">
            <div className="inv-badge">فاتورة ضريبية</div>
            <div className="inv-num amt" dir="ltr">{invoice.number}</div>
            <span className={`pill ${st.cls}`}>{st.label}</span>
          </div>
        </div>

        <div className="inv-parties">
          <div>
            <div className="inv-label">فاتورة إلى</div>
            <div className="nm">{client?.name || '—'}</div>
            {client?.phone && <div className="inv-meta amt" dir="ltr">{client.phone}</div>}
            {client?.district && <div className="inv-meta">{client.district}</div>}
          </div>
          <div style={{ textAlign: 'left' }}>
            <div className="inv-label">تاريخ الإصدار</div>
            <div>{fmtDate(invoice.issue_at)}</div>
            <div className="inv-label" style={{ marginTop: 8 }}>تاريخ الاستحقاق</div>
            <input className="filter-sel no-print" type="date" value={invoice.due_at || ''} onChange={(e) => changeDueAt(e.target.value)} disabled={busy} dir="ltr" />
            <div className="print-only">{fmtDate(invoice.due_at)}</div>
          </div>
        </div>

        <table className="inv-items">
          <thead><tr><th>الوصف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا بنود</td></tr>
            ) : items.map((it) => (
              <tr key={it.id}>
                <td>{it.description}</td>
                <td className="amt">{fmtNum(it.qty)}</td>
                <td className="amt">{fmtMoney(it.unit_price)} ⃁</td>
                <td className="amt">{fmtMoney(Number(it.qty) * Number(it.unit_price))} ⃁</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="inv-foot">
          {/* ZATCA QR — توضيحي فقط */}
          <div className="zatca-qr">
            {/* TODO: توليد ZATCA TLV QR (Base64) من الخادم وتخزينه في invoices.zatca_qr،
                ثم عرضه هنا كصورة. حالياً عنصر توضيحي. */}
            {invoice.zatca_qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={invoice.zatca_qr} alt="ZATCA QR" width={104} height={104} />
            ) : (
              <div className="qr-ph"><span>QR</span><small>ZATCA — يُولّد لاحقاً</small></div>
            )}
          </div>
          <div className="totals">
            <div className="trow"><span>المجموع الفرعي</span><span className="amt">{fmtMoney(invoice.subtotal)} ⃁</span></div>
            <div className="trow"><span>الضريبة ({invoice.vat_applicable ? `${fmtNum(invoice.vat_rate)}%` : 'معفاة'})</span><span className="amt">{fmtMoney(invoice.vat_amount)} ⃁</span></div>
            <div className="trow grand"><span>الإجمالي</span><span className="amt">{fmtMoney(invoice.total)} ⃁</span></div>
            <div className="trow"><span>المحصّل</span><span className="amt">{fmtMoney(paidAmount)} ⃁</span></div>
            <div className="trow"><span>المتبقي</span><span className="amt">{fmtMoney(remainingAmount)} ⃁</span></div>
          </div>
        </div>
      </div>

      <div className="grid2 no-print" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="sec-head"><h2>تسجيل دفعة</h2><span className={`pill ${st.cls}`}>{st.label}</span></div>
          {paymentErr && <div className="errbar">{paymentErr}</div>}
          <form onSubmit={addPayment} className="form-grid">
            <div className="field"><label>المبلغ</label><input type="number" min="0" step="0.01" value={payment.amount} onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))} dir="ltr" /></div>
            <div className="field"><label>تاريخ الدفع</label><input type="date" value={payment.paid_at} onChange={(e) => setPayment((p) => ({ ...p, paid_at: e.target.value }))} dir="ltr" /></div>
            <div className="field"><label>طريقة الدفع</label>
              <select value={payment.method} onChange={(e) => setPayment((p) => ({ ...p, method: e.target.value }))}>
                {Object.entries(PAYMENT_METHOD).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="field"><label>ملاحظة</label><input value={payment.note} onChange={(e) => setPayment((p) => ({ ...p, note: e.target.value }))} /></div>
            <div className="modal-actions" style={{ gridColumn: '1 / -1' }}>
              <button className="btn" disabled={savingPayment || remainingAmount <= 0}>{savingPayment ? 'جارٍ الحفظ…' : 'إضافة دفعة'}</button>
            </div>
          </form>
        </div>

        <div className="card" style={{ padding: '6px 0' }}>
          <div className="sec-head" style={{ padding: '14px 20px 0' }}><h2>سجل الدفعات</h2><span className="more">{fmtNum(payments.length)}</span></div>
          {payments.length === 0 ? (
            <Empty title="لا توجد دفعات" desc="سجّل أول دفعة لهذه الفاتورة." />
          ) : (
            <table>
              <thead><tr><th>التاريخ</th><th>الطريقة</th><th>المبلغ</th><th>ملاحظة</th><th></th></tr></thead>
              <tbody>
                {payments.map((row) => (
                  <tr key={row.id}>
                    <td>{fmtDate(row.paid_at)}</td>
                    <td>{PAYMENT_METHOD[row.method] || row.method}</td>
                    <td className="amt">{fmtMoney(row.amount)} ⃁</td>
                    <td>{row.note || '—'}</td>
                    <td style={{ textAlign: 'left' }}><button className="x-btn" onClick={() => deletePayment(row)} disabled={savingPayment}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
