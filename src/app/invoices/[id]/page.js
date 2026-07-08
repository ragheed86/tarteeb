'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import QRCode from 'qrcode';
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

// ترميز ZATCA TLV (المرحلة الأولى) ثم Base64 لبناء محتوى رمز QR
function zatcaTlvBase64({ seller, vat, ts, total, vatAmount }) {
  const enc = new TextEncoder();
  const field = (tag, val) => {
    const b = enc.encode(String(val ?? ''));
    return [tag, b.length, ...b];
  };
  const bytes = [
    ...field(1, seller), ...field(2, vat), ...field(3, ts),
    ...field(4, total), ...field(5, vatAmount),
  ];
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

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
  const [qrUrl, setQrUrl] = useState('');

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

  // توليد رمز QR فعلي (ZATCA) لكل فاتورة — يُستخدم المخزَّن إن وُجد، وإلا يُبنى من بيانات الفاتورة
  useEffect(() => {
    if (!d?.invoice) return;
    const { invoice, company } = d;
    if (invoice.zatca_qr) { setQrUrl(invoice.zatca_qr); return; }
    const payload = zatcaTlvBase64({
      seller: company?.name_ar || 'ترتيب لتنظيم المساحات',
      vat: company?.vat_number || '',
      ts: invoice.issue_at || new Date().toISOString(),
      total: Number(invoice.total || 0).toFixed(2),
      vatAmount: Number(invoice.vat_amount || 0).toFixed(2),
    });
    QRCode.toDataURL(payload, { margin: 0, width: 240, errorCorrectionLevel: 'M' })
      .then(setQrUrl).catch(() => setQrUrl(''));
  }, [d]);

  async function changeStatus(status) {
    setBusy(true);
    try { const up = await updateInvoice(id, { status }); setD((s) => ({ ...s, invoice: up })); }
    catch (e) { setErr(e.message || 'تعذّر التحديث'); }
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

      <div className="kpis no-print" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <div className="kpi"><div className="lbl">إجمالي الفاتورة</div><div className="val amt">{fmtMoney(invoice.total)} ⃁</div></div>
        <div className="kpi"><div className="lbl">المحصّل</div><div className="val amt">{fmtMoney(paidAmount)} ⃁</div></div>
        <div className="kpi"><div className="lbl">المتبقي</div><div className="val amt">{fmtMoney(remainingAmount)} ⃁</div></div>
        <div className="kpi"><div className="lbl">عدد الدفعات</div><div className="val amt">{fmtNum(payments.length)}</div></div>
      </div>

      {/* ورقة الفاتورة — التصميم المعتمد بمقاس A4 (مطابق 100%) */}
      <div className="inv2-page no-print-shadow">
        <div className="inv2-sheet" dir="rtl">
          {/* الرأس */}
          <div className="inv2-head">
            <div className="inv2-title">
              <div className="inv2-title-lg">فاتورة</div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="inv2-logo" src="/tarteeb-logo.png" alt="شعار ترتيب" />
          </div>

          {/* شريط البيانات + QR */}
          <div className="inv2-meta">
            <div className="inv2-meta-cols">
              <div className="inv2-meta-item">
                <div className="inv2-k">التاريخ:</div>
                <div className="inv2-v">{fmtDate(invoice.issue_at)}</div>
              </div>
              <div className="inv2-meta-item">
                <div className="inv2-k">رقم الفاتورة:</div>
                <div className="inv2-v amt" dir="ltr">#{invoice.number}</div>
              </div>
            </div>
            {qrUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img className="inv2-qr" src={qrUrl} alt="رمز الاستجابة السريعة" width={88} height={88} />
              : <div className="inv2-qr inv2-qr-ph"><span>QR</span></div>}
          </div>

          {/* بطاقتا الطرفين */}
          <div className="inv2-parties">
            <div className="inv2-party">
              <div className="inv2-k">مصدرة من:</div>
              <div className="inv2-party-name">{company?.name_ar || 'مؤسسة دلال محمد عبدالله الجعويني التجارية'}</div>
              {company?.cr_number && <div className="inv2-party-line"><b>سجل تجاري:</b> <span dir="ltr">{company.cr_number}</span></div>}
              {company?.vat_number && <div className="inv2-party-line"><b>الرقم الضريبي:</b> <span dir="ltr">{company.vat_number}</span></div>}
            </div>
            <div className="inv2-party">
              <div className="inv2-k">مصدرة إلى:</div>
              <div className="inv2-party-name">{client?.name || '—'}</div>
              {client?.phone && <div className="inv2-party-line">رقم الجوال: <span dir="ltr">{client.phone}</span></div>}
              <div className="inv2-party-line">{client?.district ? `${client.district}، الرياض` : 'الرياض، المملكة العربية السعودية'}</div>
            </div>
          </div>

          {/* جدول البنود */}
          <div className="inv2-table">
            <div className="inv2-row inv2-thead">
              <div className="c-desc">وصف البند</div>
              <div className="c-num">السعر</div>
              <div className="c-num">الوحدة</div>
              <div className="c-num">الكمية</div>
              <div className="c-num">المجموع</div>
            </div>
            {items.length === 0 ? (
              <div className="inv2-empty">لا بنود</div>
            ) : items.map((it) => (
              <div className="inv2-row inv2-tr" key={it.id}>
                <div className="c-desc">{it.description}</div>
                <div className="c-num muted"><span dir="ltr">⃁ {fmtMoney(it.unit_price)}</span></div>
                <div className="c-num muted">ساعة</div>
                <div className="c-num muted">{fmtNum(it.qty)}</div>
                <div className="c-num strong"><span dir="ltr">⃁ {fmtMoney(Number(it.qty) * Number(it.unit_price))}</span></div>
              </div>
            ))}

            <div className="inv2-row inv2-total-row">
              <div className="inv2-total-lbl">الإجمالي الفرعي</div>
              <div className="c-num"><span dir="ltr">⃁ {fmtMoney(invoice.subtotal)}</span></div>
            </div>
            <div className="inv2-row inv2-total-row">
              <div className="inv2-total-lbl">الخصم</div>
              <div className="c-num"><span dir="ltr">⃁ {fmtMoney(0)}</span></div>
            </div>
            <div className="inv2-row inv2-total-row">
              <div className="inv2-total-lbl">{invoice.vat_applicable ? `ضريبة القيمة المضافة (${fmtNum(invoice.vat_rate)}٪)` : 'ضريبة القيمة المضافة (معفاة)'}</div>
              <div className="c-num"><span dir="ltr">⃁ {fmtMoney(invoice.vat_amount)}</span></div>
            </div>
            <div className="inv2-row inv2-grand">
              <div className="inv2-total-lbl">الإجمالي</div>
              <div className="c-num"><span dir="ltr">⃁ {fmtMoney(invoice.total)}</span></div>
            </div>
          </div>

          {/* ملاحظة */}
          <div className="inv2-note">
            حرصًا على سلامة مقتنياتكم، نأمل حفظ الأغراض الثمينة وإبلاغ المشرفة عن القطع الحساسة، والتأكد من اكتمال الخدمة قبل مغادرة الفريق. وبعد اعتماد الخدمة ومغادرة الفريق، لا تتحمل «ترتيب» مسؤولية أي فقدان أو ملاحظات يتم الإبلاغ عنها لاحقًا.
          </div>

          {/* التذييل — سطر واحد: الموقع والرابط فقط */}
          <div className="inv2-footer">
            <div className="inv2-fitem">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#17A2A6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
              <span>المملكة العربية السعودية، الرياض</span>
            </div>
            <div className="inv2-fitem">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#17A2A6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
              <span dir="ltr">tarteebandmore.com</span>
            </div>
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
