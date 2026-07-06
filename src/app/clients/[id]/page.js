'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  getClient, getProjectsByClient, getInvoicesByClient, getCommunications, createCommunication,
} from '@/lib/data';
import {
  fmtMoney, fmtNum, fmtDate, CLIENT_STATUS, PROJECT_STATUS, INVOICE_STATUS, SOURCE_LABEL,
} from '@/lib/format';
import { Loading, Empty, ErrorBar } from '../../ui';

const CHANNEL = { whatsapp: 'واتساب', telegram: 'تيليجرام', email: 'بريد', phone: 'هاتف', system: 'النظام' };
const DIRECTION = { in: 'وارد', out: 'صادر', system: 'النظام' };

function CommForm({ clientId, onAdded }) {
  const [form, setForm] = useState({ channel: 'whatsapp', direction: 'out', body: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function add(e) {
    e.preventDefault();
    if (!form.body.trim()) { setErr('اكتب نص التواصل'); return; }
    setBusy(true); setErr('');
    try {
      const row = await createCommunication({
        client_id: clientId, channel: form.channel, direction: form.direction, body: form.body.trim(),
      });
      setForm((f) => ({ ...f, body: '' }));
      onAdded(row);
    } catch (e2) {
      setErr(e2.message || 'تعذّر تسجيل التواصل');
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={add} style={{ marginBottom: 14 }}>
      {err && <div className="errbar">{err}</div>}
      <div className="inline-add" style={{ flexWrap: 'wrap' }}>
        <select value={form.channel} onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))} style={{ maxWidth: 120 }}>
          {Object.entries(CHANNEL).filter(([v]) => v !== 'system').map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={form.direction} onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value }))} style={{ maxWidth: 100 }}>
          <option value="out">صادر</option>
          <option value="in">وارد</option>
        </select>
        <input
          placeholder="ماذا دار في التواصل؟" value={form.body}
          onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} style={{ flex: 1, minWidth: 180 }}
        />
        <button className="btn sm" disabled={busy}>{busy ? 'جارٍ…' : 'إضافة'}</button>
      </div>
    </form>
  );
}

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
  const paid = invoices.reduce((s, i) => s + Number(i.paid_amount || 0), 0);
  const outstanding = invoices.reduce((s, i) => s + Number(i.remaining_amount || 0), 0);

  return (
    <>
      <button className="back-link" onClick={() => router.push('/clients')}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        رجوع للعملاء
      </button>

      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <div className="kpi"><div className="lbl">إجمالي المفوتر</div><div className="val amt">{fmtMoney(invoiced)} ⃁</div></div>
        <div className="kpi"><div className="lbl">المحصّل</div><div className="val amt">{fmtMoney(paid)} ⃁</div></div>
        <div className="kpi"><div className="lbl">المتبقّي</div><div className="val amt">{fmtMoney(outstanding)} ⃁</div></div>
        <div className="kpi"><div className="lbl">عدد الفواتير</div><div className="val amt">{fmtNum(invoices.length)}</div></div>
      </div>

      <div className="grid2">
        {/* بيانات العميل */}
        <div className="card">
          <div className="sec-head"><h2>{client.name}</h2><span className={`pill ${st.cls}`} style={{ marginInlineStart: 'auto' }}>{st.label}</span></div>
          <div className="kv"><span className="k">الجوال</span><span className="v amt" dir="ltr">{client.phone || '—'}</span></div>
          <div className="kv"><span className="k">الحي</span><span className="v">{client.district || '—'}</span></div>
          <div className="kv"><span className="k">المصدر</span><span className="v">{SOURCE_LABEL[client.source] || client.source || '—'}</span></div>
          {(client.referred_by_client || client.referred_by_employee) && (
            <div className="kv"><span className="k">أحاله</span><span className="v">{client.referred_by_client?.name || client.referred_by_employee?.name}</span></div>
          )}
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
          <CommForm clientId={client.id} onAdded={(m) => setData((d) => ({ ...d, comms: [m, ...d.comms] }))} />
          {comms.length === 0 ? (
            <Empty title="لا سجلات" desc="سجّل أول تواصل مع هذا العميل من النموذج أعلاه." />
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
                    <td className="amt">{fmtMoney(p.sale_price)} ⃁</td>
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
            <thead><tr><th>رقم</th><th>الإصدار</th><th>الاستحقاق</th><th>الإجمالي</th><th>المحصّل</th><th>المتبقي</th><th>الحالة</th></tr></thead>
            <tbody>
              {invoices.map((i) => {
                const is = INVOICE_STATUS[i.status] || { label: i.status, cls: 'p-wait' };
                return (
                  <tr key={i.id} className="clickable" onClick={() => router.push(`/invoices/${i.id}`)}>
                    <td className="amt" dir="ltr" style={{ textAlign: 'start' }}>{i.number || '—'}</td>
                    <td>{fmtDate(i.issue_at)}</td>
                    <td>{fmtDate(i.due_at)}</td>
                    <td className="amt">{fmtMoney(i.total)} ⃁</td>
                    <td className="amt">{fmtMoney(i.paid_amount)} ⃁</td>
                    <td className="amt">{fmtMoney(i.remaining_amount)} ⃁</td>
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
