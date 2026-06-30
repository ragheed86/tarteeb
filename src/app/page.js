'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getClients, getProjects, getInvoices, getInventory, getWarehouses } from '@/lib/data';
import { fmtMoney, fmtNum, fmtDate, PROJECT_STATUS } from '@/lib/format';
import { Loading, Empty, ErrorBar } from './ui';

const ACTIVE = ['quote', 'preparing', 'in_progress'];
const OPEN_DELIVERY = ['quote', 'preparing', 'in_progress', 'delivered'];

function daysUntil(d) { return d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) : null; }

export default function Dashboard() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [clients, projects, invoices, inventory, warehouses] = await Promise.all([
          getClients(), getProjects(), getInvoices(), getInventory(), getWarehouses(),
        ]);
        const revenue = invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + Number(i.total || 0), 0);
        const outstanding = invoices.filter((i) => i.status !== 'paid' && i.status !== 'draft').reduce((s, i) => s + Number(i.total || 0), 0);
        const activeProjects = projects.filter((p) => ACTIVE.includes(p.status)).length;
        const newClients = clients.filter((c) => withinDays(c.created_at, 30)).length;
        const lowStock = inventory.filter((it) => Number(it.quantity) < Number(it.reorder_level));
        const upcoming = projects
          .filter((p) => OPEN_DELIVERY.includes(p.status) && p.due_date && daysUntil(p.due_date) !== null && daysUntil(p.due_date) <= 14)
          .sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
        setData({ clients, projects, invoices, warehouses, revenue, outstanding, activeProjects, newClients, lowStock, upcoming });
      } catch (e) {
        setErr(e.message || 'تعذّر تحميل البيانات');
      }
    })();
  }, []);

  if (err) return <ErrorBar message={err} />;
  if (!data) return <Loading />;

  const kpis = [
    { lbl: 'إيرادات محصّلة', val: fmtMoney(data.revenue) + ' ر.س', sub: 'من الفواتير المدفوعة' },
    { lbl: 'مبالغ مستحقّة', val: fmtMoney(data.outstanding) + ' ر.س', sub: 'فواتير غير مدفوعة/متأخرة' },
    { lbl: 'مشاريع نشطة', val: fmtNum(data.activeProjects), sub: `من ${fmtNum(data.projects.length)} إجمالاً` },
    { lbl: 'إجمالي العملاء', val: fmtNum(data.clients.length), sub: `${fmtNum(data.newClients)} جديد خلال 30 يوماً` },
    { lbl: 'تنبيهات المخزون', val: fmtNum(data.lowStock.length), sub: 'أصناف تحت حد التنبيه' },
    { lbl: 'تسليمات قريبة', val: fmtNum(data.upcoming.length), sub: 'خلال 14 يوماً' },
  ];

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

      <div className="grid2">
        {/* تسليمات قريبة */}
        <div className="card">
          <div className="sec-head"><h2>تسليمات قريبة</h2><span className="more">{fmtNum(data.upcoming.length)}</span></div>
          {data.upcoming.length === 0 ? (
            <Empty title="لا تسليمات قريبة" desc="لا مشاريع مستحقّة خلال 14 يوماً." />
          ) : (
            <div className="alert-list">
              {data.upcoming.map((p) => {
                const n = daysUntil(p.due_date);
                const st = PROJECT_STATUS[p.status] || { label: p.status, cls: 'p-wait' };
                return (
                  <div className="alert-row clickable" key={p.id} onClick={() => router.push(`/projects/${p.id}`)} style={{ cursor: 'pointer' }}>
                    <span className="nm">{p.title}</span>
                    <span className={`pill ${st.cls}`}>{st.label}</span>
                    <span className="tag" style={{ color: n < 0 ? 'var(--neg)' : n <= 3 ? 'var(--gold)' : 'var(--muted)' }}>
                      {n < 0 ? `متأخر ${fmtNum(-n)} يوم` : n === 0 ? 'اليوم' : `خلال ${fmtNum(n)} يوم`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* تنبيهات المخزون */}
        <div className="card">
          <div className="sec-head"><h2>تنبيهات المخزون</h2><span className="more">{fmtNum(data.lowStock.length)}</span></div>
          {data.lowStock.length === 0 ? (
            <Empty title="المخزون بحالة جيدة" desc="لا أصناف تحت حد التنبيه." />
          ) : (
            <div className="alert-list">
              {data.lowStock.slice(0, 8).map((it) => (
                <div className="alert-row clickable" key={it.id} onClick={() => router.push('/warehouse')} style={{ cursor: 'pointer' }}>
                  <span className="nm">{it.name}</span>
                  <span className="tag amt" style={{ color: 'var(--neg)' }}>{fmtNum(it.quantity)} / {fmtNum(it.reorder_level)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* أحدث المشاريع */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="sec-head"><h2>أحدث المشاريع</h2><span className="more">{fmtNum(data.projects.length)} مشروع</span></div>
        {data.projects.length === 0 ? (
          <Empty title="لا توجد مشاريع بعد" desc="ابدأ بإضافة أول مشروع لعميل." />
        ) : (
          <table>
            <thead><tr><th>المشروع</th><th>الخدمة</th><th>قيمة العقد</th><th>التقدّم</th><th>الحالة</th></tr></thead>
            <tbody>
              {data.projects.slice(0, 6).map((p) => {
                const st = PROJECT_STATUS[p.status] || { label: p.status, cls: 'p-wait' };
                return (
                  <tr key={p.id} className="clickable" onClick={() => router.push(`/projects/${p.id}`)}>
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
