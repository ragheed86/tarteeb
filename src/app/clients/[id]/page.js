'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  getClient, getProjectsByClient, getInvoicesByClient, getCommunications,
} from '@/lib/data';
import {
  fmtMoney, fmtNum, fmtDate, CLIENT_STATUS, PROJECT_STATUS, INVOICE_STATUS, SOURCE_LABEL,
} from '@/lib/format';
import { Loading, Empty, ErrorBar } from '../../ui';

const CHANNEL = { whatsapp: 'واتساب', telegram: 'تيليجرام', email: 'بريد', phone: 'هاتف', system: 'النظام' };
const DIRECTION = { in: 'وارد', out: 'صادر', system: 'النظام' };

export default function ClientProfile() {
  const { id } = useParams();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      setErr('');
      try {
        const [client, projects, invoices, comms] = await Promise.all([
          getClient(id), getProjectsByClient(id), getInvoicesByClient(id), getCommunications(id),
        ]);
        setData({ client, projects, invoices, comms });
      } catch (e) {
        setErr(e.message || 'تعذّر تحميل ملف العميل');
      }
    })();
  }, [id]);

  if (err) return <ErrorBar message={err} />;
  if (!data) return <Loading />;

  const { client, projects, invoices, comms } = data;
  if (!client) return <Empty title="غير موجود" desc="لم يُعثر على هذا العميل." />;

  const st = CLIENT_STATUS[client.status] || { label: client.status, cls: 'p-wait' };
  const invoiced = invoices.reduce((s, i) => s + Number(i.total || 0), 0);
  const paid = invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + Number(i.total || 0), 0);
  const outstanding = invoiced - paid;

  return (
    <>
      <button className="back-link" onClick={() => router.push('/clients')}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        رجوع للعملاء
      </button>

      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <div className="kpi"><div className="lbl">إجمالي المفوتر</div><div className="val amt">{fmtMoney(invoiced)} ر.س</div></div>
        <div className="kpi"><div className="lbl">المحصّل</div><div className="val amt">{fmtMoney(paid)} ر.س</div></div>
        <div className="kpi"><div className="lbl">المتبقّي</div><div className="val amt">{fmtMoney(outstanding)} ر.س</div></div>
        <div className="kpi"><div className="lbl">عدد الفواتير</div><div className="val amt">{fmtNum(invoices.length)}</div></div>
      </div>

      <div className="grid2">
        {/* بيانات العميل */}
        <div className="card">
          <div className="sec-head"><h2>{client.name}</h2><span className={`pill ${st.cls}`} style={{ marginInlineStart: 'auto' }}>{st.label}</span></div>
          <div className="kv"><span className="k">الجوال</span><span className="v amt" dir="ltr">{client.phone || '—'}</span></div>
          <div className="kv"><span className="k">الحي</span><span className="v">{client.district || '—'}</span></div>
          <div className="kv"><span className="k">المصدر</span><span className="v">{SOURCE_LABEL[client.source] || client.source || '—'}</span></div>
          <div className="kv"><span className="k">الكود</span><span className="v amt" dir="ltr">{client.code || '—'}</span></div>
          <div className="kv"><span className="k">أول تواصل</span><span className="v">{fmtDate(client.first_contact_at)}</span></div>
          <div className="kv"><span className="k">مُضاف في</span><span className="v">{fmtDate(client.created_at)}</span></div>
          {client.notes && (
            <div style={{ marginTop: 14 }}>
              <div className="k" style={{ marginBottom: 6 }}>ملاحظات</div>
              <div style={{ fontSize: 14, lineHeight: 1.8 }}>{client.notes}</div>
            </div>
          )}
        </div>

        {/* سجل التواصل */}
        <div className="card">
          <div className="sec-head"><h2>سجل التواصل</h2><span className="more">{fmtNum(comms.length)}</span></div>
          {comms.length === 0 ? (
            <Empty title="لا سجلات" desc="لا يوجد سجل تواصل لهذا العميل بعد." />
          ) : (
            <div className="timeline">
              {comms.map((m) => (
                <div className="timeline-item" key={m.id}>
                  <span className="timeline-dot" />
                  <div className="timeline-body">
                    <div>{m.body || '—'}</div>
                    <div className="meta">{CHANNEL[m.channel] || m.channel} · {DIRECTION[m.direction] || m.direction} · {fmtDate(m.occurred_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* المشاريع */}
      <div className="card" style={{ marginTop: 16, padding: '6px 0' }}>
        <div className="sec-head" style={{ padding: '14px 20px 0' }}><h2>المشاريع</h2><span className="more">{fmtNum(projects.length)} مشروع</span></div>
        {projects.length === 0 ? (
          <Empty title="لا مشاريع" desc="لا توجد مشاريع لهذا العميل بعد." />
        ) : (
          <table>
            <thead><tr><th>المشروع</th><th>الخدمة</th><th>قيمة العقد</th><th>الحالة</th><th>التسليم</th></tr></thead>
            <tbody>
              {projects.map((p) => {
                const ps = PROJECT_STATUS[p.status] || { label: p.status, cls: 'p-wait' };
                return (
                  <tr key={p.id} className="clickable" onClick={() => router.push(`/projects/${p.id}`)}>
                    <td><span className="nm">{p.title}</span></td>
                    <td>{p.service_type || '—'}</td>
                    <td className="amt">{fmtMoney(p.sale_price)} ر.س</td>
                    <td><span className={`pill ${ps.cls}`}>{ps.label}</span></td>
                    <td>{fmtDate(p.due_date)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* الفواتير */}
      <div className="card" style={{ marginTop: 16, padding: '6px 0' }}>
        <div className="sec-head" style={{ padding: '14px 20px 0' }}><h2>الفواتير</h2><span className="more">{fmtNum(invoices.length)} فاتورة</span></div>
        {invoices.length === 0 ? (
          <Empty title="لا فواتير" desc="لا توجد فواتير لهذا العميل بعد." />
        ) : (
          <table>
            <thead><tr><th>رقم</th><th>التاريخ</th><th>الإجمالي</th><th>الحالة</th></tr></thead>
            <tbody>
              {invoices.map((i) => {
                const is = INVOICE_STATUS[i.status] || { label: i.status, cls: 'p-wait' };
                return (
                  <tr key={i.id} className="clickable" onClick={() => router.push(`/invoices/${i.id}`)}>
                    <td className="amt" dir="ltr" style={{ textAlign: 'start' }}>{i.number || '—'}</td>
                    <td>{fmtDate(i.issue_at)}</td>
                    <td className="amt">{fmtMoney(i.total)} ر.س</td>
                    <td><span className={`pill ${is.cls}`}>{is.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
