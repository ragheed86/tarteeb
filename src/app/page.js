'use client';
import { useEffect, useState } from 'react';
import { getClients, getProjects, getInvoices } from '@/lib/data';
import { fmtMoney, fmtNum, PROJECT_STATUS } from '@/lib/format';
import { Loading, Empty, ErrorBar } from './ui';

const ACTIVE = ['quote', 'preparing', 'in_progress'];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [clients, projects, invoices] = await Promise.all([getClients(), getProjects(), getInvoices()]);
        const revenue = invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + Number(i.total || 0), 0);
        const activeProjects = projects.filter((p) => ACTIVE.includes(p.status)).length;
        const newClients = clients.filter((c) => withinDays(c.created_at, 30)).length;
        setData({ clients, projects, invoices, revenue, activeProjects, newClients });
      } catch (e) {
        setErr(e.message || 'تعذّر تحميل البيانات');
      }
    })();
  }, []);

  if (err) return <ErrorBar message={err} />;
  if (!data) return <Loading />;

  const kpis = [
    { lbl: 'إيرادات محصّلة', val: fmtMoney(data.revenue) + ' ر.س', sub: 'من الفواتير المدفوعة' },
    { lbl: 'إجمالي العملاء', val: fmtNum(data.clients.length), sub: `${fmtNum(data.newClients)} جديد خلال 30 يوماً` },
    { lbl: 'مشاريع نشطة', val: fmtNum(data.activeProjects), sub: `من ${fmtNum(data.projects.length)} إجمالاً` },
    { lbl: 'الفواتير', val: fmtNum(data.invoices.length), sub: 'إجمالي المُصدرة' },
  ];

  const recent = data.projects.slice(0, 6);

  return (
    <>
      <div className="kpis">
        {kpis.map((k, i) => (
          <div className="kpi" key={i}>
            <div className="lbl">{k.lbl}</div>
            <div className="val amt">{k.val}</div>
            <div className="trend"><span>{k.sub}</span></div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="sec-head"><h2>أحدث المشاريع</h2><span className="more">{fmtNum(data.projects.length)} مشروع</span></div>
        {recent.length === 0 ? (
          <Empty title="لا توجد مشاريع بعد" desc="ابدأ بإضافة أول مشروع لعميل." />
        ) : (
          <table>
            <thead><tr><th>المشروع</th><th>الخدمة</th><th>قيمة العقد</th><th>التقدّم</th><th>الحالة</th></tr></thead>
            <tbody>
              {recent.map((p) => {
                const st = PROJECT_STATUS[p.status] || { label: p.status, cls: 'p-wait' };
                return (
                  <tr key={p.id}>
                    <td><span className="nm">{p.title}</span></td>
                    <td>{p.service_type || '—'}</td>
                    <td className="amt">{fmtMoney(p.sale_price)} ر.س</td>
                    <td><div className="prog" style={{ width: 90 }}><i style={{ width: `${p.progress || 0}%` }} /></div></td>
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

function withinDays(date, days) {
  if (!date) return false;
  return (Date.now() - new Date(date).getTime()) / 86400000 <= days;
}
