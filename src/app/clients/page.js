'use client';
import { useEffect, useState } from 'react';
import { getClients } from '@/lib/data';
import { fmtNum, CLIENT_STATUS, SOURCE_LABEL } from '@/lib/format';
import { Loading, Empty, ErrorBar } from '../ui';

export default function ClientsPage() {
  const [clients, setClients] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    getClients().then(setClients).catch((e) => setErr(e.message || 'تعذّر التحميل'));
  }, []);

  if (err) return <ErrorBar message={err} />;
  if (!clients) return <Loading />;

  return (
    <>
      <div className="sec-head" style={{ marginBottom: 18 }}>
        <button className="btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          عميل جديد
        </button>
        <span className="more" style={{ marginInlineStart: 'auto' }}>{fmtNum(clients.length)} عميلاً</span>
      </div>
      <div className="card" style={{ padding: '6px 0' }}>
        {clients.length === 0 ? (
          <Empty title="لا يوجد عملاء بعد" desc="أضف أول عميل لتظهر بياناته هنا." />
        ) : (
          <table>
            <thead><tr><th>العميل</th><th>الجوال</th><th>المصدر</th><th>الحي</th><th>الحالة</th></tr></thead>
            <tbody>
              {clients.map((c) => {
                const st = CLIENT_STATUS[c.status] || { label: c.status || '—', cls: 'p-wait' };
                return (
                  <tr key={c.id}>
                    <td><span className="nm">{c.name}</span><br /><span className="uid">{c.code || '—'}</span></td>
                    <td className="amt" dir="ltr" style={{ textAlign: 'start' }}>{c.phone || '—'}</td>
                    <td><span className="src">{SOURCE_LABEL[c.source] || c.source || '—'}</span></td>
                    <td>{c.district || '—'}</td>
                    <td><span className={`pill ${st.cls}`}>{st.label}</span></td>
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
