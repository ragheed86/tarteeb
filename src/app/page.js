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
  const [period, setPeriod] = useState('month');

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

  const periodData = {
    day: { lbl: 'إيرادات اليوم', rev: '2,400', profit: '1,080', margin: '45%', newc: '1' },
    week: { lbl: 'إيرادات الأسبوع', rev: '12,800', profit: '5,760', margin: '45%', newc: '2' },
    month: { lbl: 'إيرادات الشهر', rev: '48,200', profit: '21,650', margin: '45%', newc: '6' },
    year: { lbl: 'إيرادات السنة', rev: '512,400', profit: '228,900', margin: '47%', newc: '41' },
  };
  const p = periodData[period];

  return (
    <>
      <div className="sec-head"><h2>تسليمات قادمة</h2><span className="more">العدّ التنازلي للمواعيد</span></div>
      <div className="countdowns">
        {data.upcoming.slice(0, 4).map((item) => {
          const n = daysUntil(item.due_date);
          return (
            <div className="cdcard" key={item.id}>
              <div className="ring"><b>{n === null ? '—' : n < 0 ? fmtNum(-n) : fmtNum(n)}</b><span>{n < 0 ? 'متأخر' : 'يوم'}</span></div>
              <div><div className={`cdttl${n !== null && n <= 3 ? ' urgent' : ''}`}>{n < 0 ? `متأخر ${fmtNum(-n)} يوم` : n === 0 ? 'اليوم' : `خلال ${fmtNum(n)} يوم`}</div><small>{item.title}</small></div>
            </div>
          );
        })}
        {data.upcoming.length === 0 && (
          <>
            <div className="cdcard"><div className="ring"><b>0</b><span>يوم</span></div><div><div className="cdttl">لا تسليمات قريبة</div><small>لا مشاريع مستحقة خلال 14 يوماً</small></div></div>
            <div className="cdcard"><div className="ring"><b>0</b><span>يوم</span></div><div><div className="cdttl">لا زيارات قريبة</div><small>جدول الفريق فارغ حالياً</small></div></div>
          </>
        )}
      </div>

      <div className="sec-head" style={{ marginBottom: 14 }}>
        <h2>مؤشرات الأداء</h2>
        <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" className="fdate" defaultValue="2026-06-29" onChange={() => setPeriod('day')} />
          <div className="viewtoggle">
            {[
              ['day', 'يوم'],
              ['week', 'أسبوع'],
              ['month', 'شهر'],
              ['year', 'سنة'],
            ].map(([key, label]) => <button className={`vt${period === key ? ' active' : ''}`} key={key} onClick={() => setPeriod(key)}>{label}</button>)}
          </div>
        </div>
      </div>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="kpi"><div className="lbl">{p.lbl}</div><div className="val">{p.rev} ر.س</div><div className="trend up">▲ مقابل الفترة السابقة</div></div>
        <div className="kpi pos"><div className="lbl">صافي الربح</div><div className="val">{p.profit} ر.س</div><div className="trend"><span>بعد خصم كل التكاليف</span></div></div>
        <div className="kpi"><div className="lbl">متوسط هامش الربح</div><div className="val">{p.margin}</div><div className="trend"><span>على مستوى المشاريع</span></div></div>
        <div className="kpi"><div className="lbl">العملاء الجدد</div><div className="val">{p.newc}</div><div className="trend up">▲ مقابل الفترة السابقة</div></div>
        <div className="kpi"><div className="lbl">مشاريع نشطة</div><div className="val">{fmtNum(data.activeProjects)}</div><div className="trend"><span>{fmtNum(data.upcoming.length)} تسلّم هذا الأسبوع</span></div></div>
        <div className="kpi alert"><div className="lbl">تنبيهات المستودع</div><div className="val">{fmtNum(data.lowStock.length)}</div><div className="trend down">أصناف وصلت حد النفاد</div></div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="sec-head"><h2>الإيرادات والأرباح</h2><span className="more">آخر 6 أشهر</span></div>
          <div className="bars">
            {[
              ['يناير', '42%'], ['فبراير', '55%'], ['مارس', '48%'], ['أبريل', '68%'], ['مايو', '74%'], ['يونيو', '92%'],
            ].map(([month, height]) => (
              <div className={`bar${month === 'يونيو' ? ' cur' : ''}`} key={month}>
                <div className="col"><div className="fill" style={{ height }} /></div><small>{month}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="sec-head"><h2>مصدر العملاء</h2></div>
          {[
            ['انستقرام', '52%', 'var(--gold)'],
            ['تيك توك', '28%', 'var(--sage)'],
            ['توصية صديق', '14%', 'var(--green)'],
            ['أخرى', '6%', 'var(--faint)'],
          ].map(([label, width, color]) => (
            <div className="srcrow" key={label}><span style={{ width: 74 }}>{label}</span><div className="track"><div className="tf" style={{ width, background: color }} /></div><span className="pct">{width}</span></div>
          ))}
          <div className="note">أعلى ربحية فعلية من <b style={{ color: 'var(--green)' }}>توصية صديق</b> رغم قلة عددها</div>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="sec-head"><h2>تسليمات قريبة</h2><span className="more">{fmtNum(data.upcoming.length)}</span></div>
          {data.upcoming.length === 0 ? <Empty title="لا تسليمات قريبة" desc="لا مشاريع مستحقّة خلال 14 يوماً." /> : (
            <div className="alert-list">
              {data.upcoming.map((project) => {
                const n = daysUntil(project.due_date);
                const st = PROJECT_STATUS[project.status] || { label: project.status, cls: 'p-wait' };
                return <div className="alert-row clickable" key={project.id} onClick={() => router.push(`/projects/${project.id}`)} style={{ cursor: 'pointer' }}><span className="nm">{project.title}</span><span className={`pill ${st.cls}`}>{st.label}</span><span className="tag" style={{ color: n < 0 ? 'var(--neg)' : n <= 3 ? 'var(--gold)' : 'var(--muted)' }}>{n < 0 ? `متأخر ${fmtNum(-n)} يوم` : n === 0 ? 'اليوم' : `خلال ${fmtNum(n)} يوم`}</span></div>;
              })}
            </div>
          )}
        </div>
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
