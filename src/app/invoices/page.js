'use client';
import { useEffect, useState } from 'react';
import { getInvoices, getClients } from '@/lib/data';
import { fmtMoney, fmtNum, fmtDate, INVOICE_STATUS } from '@/lib/format';
import { Loading, Empty, ErrorBar } from '../ui';

export default function InvoicesPage() {
  const [state, setState] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [invoices, clients] = await Promise.all([getInvoices(), getClients()]);
        const byId = Object.fromEntries(clients.map((c) => [c.id, c.name]));
        setState({ invoices, byId });
      } catch (e) {
        setErr(e.message || 'تعذّر التحميل');
      }
    })();
  }, []);

  if (err) return <ErrorBar message={err} />;
  if (!state) return <Loading />;

  const { invoices, byId } = state;
  const totalPaid = invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + Number(i.total || 0), 0);
  const totalAll = invoices.reduce((s, i) => s + Number(i.total || 0), 0);

  return (
    <>
      <div className="sec-head" style={{ marginBottom: 18 }}>
        <button className="btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          فاتورة جديدة
        </button>
        <span className="more" style={{ marginInlineStart: 'auto' }}>
          {fmtNum(invoices.length)} فاتورة · محصّل {fmtMoney(totalPaid)} من {fmtMoney(totalAll)} ر.س
        </span>
      </div>
      <div className="card" style={{ padding: '6px 0' }}>
        {invoices.length === 0 ? (
          <Empty title="لا توجد فواتير بعد" desc="أنشئ أول فاتورة لمشروع لتظهر هنا." />
        ) : (
          <table>
            <thead><tr><th>رقم الفاتورة</th><th>العميل</th><th>التاريخ</th><th>الإجمالي</th><th>الضريبة</th><th>الحالة</th></tr></thead>
            <tbody>
              {invoices.map((inv) => {
                const st = INVOICE_STATUS[inv.status] || { label: inv.status, cls: 'p-wait' };
                return (
                  <tr key={inv.id}>
                    <td><span className="nm amt">{inv.number || '—'}</span></td>
                    <td>{byId[inv.client_id] || '—'}</td>
                    <td>{fmtDate(inv.issue_at)}</td>
                    <td className="amt">{fmtMoney(inv.total)} ر.س</td>
                    <td className="amt">{inv.vat_applicable ? `${fmtMoney(inv.vat_amount)} ر.س` : 'معفاة'}</td>
                    <td><span className={`pill ${st.cls}`}>{st.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}><b>الإجمالي</b></td>
                <td className="amt"><b>{fmtMoney(totalAll)} ر.س</b></td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </>
  );
}
