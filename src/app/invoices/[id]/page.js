'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  getInvoice, getInvoiceItems, getClient, getCompanySettings, updateInvoice,
} from '@/lib/data';
import { fmtMoney, fmtNum, fmtDate, INVOICE_STATUS } from '@/lib/format';
import { Loading, Empty, ErrorBar } from '../../ui';

const STATUS_OPTS = [
  { value: 'draft', label: 'مسودة' },
  { value: 'unpaid', label: 'غير مدفوعة' },
  { value: 'paid', label: 'مدفوعة' },
  { value: 'overdue', label: 'متأخرة' },
];

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

  async function load() {
    setErr('');
    try {
      const invoice = await getInvoice(id);
      const [items, client, company] = await Promise.all([
        getInvoiceItems(id),
        invoice.client_id ? getClient(invoice.client_id) : Promise.resolve(null),
        getCompanySettings().catch(() => null),
      ]);
      setD({ invoice, items, client, company });
    } catch (e) { setErr(e.message || 'تعذّر تحميل الفاتورة'); }
  }
  useEffect(() => { load(); }, [id]);

  async function changeStatus(status) {
    setBusy(true);
    try { const up = await updateInvoice(id, { status }); setD((s) => ({ ...s, invoice: up })); }
    catch (e) { setErr(e.message || 'تعذّر التحديث'); }
    finally { setBusy(false); }
  }

  if (err) return <ErrorBar message={err} />;
  if (!d) return <Loading />;

  const { invoice, items, client, company } = d;
  if (!invoice) return <Empty title="غير موجودة" desc="لم يُعثر على هذه الفاتورة." />;
  const st = INVOICE_STATUS[invoice.status] || { label: invoice.status, cls: 'p-wait' };
  const wa = waLink(client?.phone, `فاتورة ${invoice.number} من ${company?.name_ar || 'ترتيب'} بقيمة ${fmtMoney(invoice.total)} ⃁`);

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
          </div>
        </div>
      </div>
    </>
  );
}
