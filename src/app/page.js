'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getClients, getProjects, getInvoices, getInventory, getAllProjectCosts,
  getAllInvoicePayments, getDashboardMedia, uploadDashboardMedia, removeDashboardMedia, getCompanyExpenses,
} from '@/lib/data';
import { fmtMoney, fmtNum, fmtDate, PROJECT_STATUS, SOURCE_LABEL, OPEN_DELIVERY_STATUSES } from '@/lib/format';
import { Loading, Empty, ErrorBar, KpiCard } from '@/components';
import AnimatedNumber from './AnimatedNumber';

const ACTIVE = ['quote', 'preparing', 'in_progress'];
const OPEN_DELIVERY = OPEN_DELIVERY_STATUSES;
const PERIOD_DAYS = { day: 1, week: 7, month: 30, year: 365 };
const PERIOD_LABEL = { day: 'إيرادات اليوم', week: 'إيرادات الأسبوع', month: 'إيرادات الشهر', year: 'إيرادات السنة' };
const PERIOD_SCOPE = { day: 'آخر يوم', week: 'آخر 7 أيام', month: 'آخر 30 يومًا', year: 'آخر 365 يومًا' };
const ARABIC_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const SOURCE_COLORS = ['var(--gold)', 'var(--sage)', 'var(--green)', 'var(--faint)', 'var(--pine)', 'var(--neg)'];

function daysUntil(d) { return d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) : null; }
// ضمن آخر «days» يوماً فقط (نافذة ماضية مغلقة الطرفين) — لا تُدخل التواريخ المستقبلية
function withinDays(date, days) {
  if (!date) return false;
  const diff = (Date.now() - new Date(date).getTime()) / 86400000;
  return diff >= 0 && diff <= days;
}
// صيغة مختصرة للقيم على أعمدة المخطط: 13229 → «13.2K»، 950 → «950»
function compactMoney(n) {
  const v = Number(n) || 0;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 100000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(Math.round(v));
}

const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // حد Supabase الافتراضي 50 ميجابايت

export default function Dashboard() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [period, setPeriod] = useState('month');
  const [media, setMedia] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [mediaErr, setMediaErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [clients, projects, invoices, payments, inventory, costs, companyExpenses] = await Promise.all([
          getClients(), getProjects(), getInvoices(), getAllInvoicePayments(), getInventory(), getAllProjectCosts(), getCompanyExpenses().catch(() => []),
        ]);
        const activeProjects = projects.filter((p) => ACTIVE.includes(p.status)).length;
        const lowStock = inventory.filter((it) => Number(it.quantity) < Number(it.reorder_level));
        const clientsById = Object.fromEntries(clients.map((client) => [client.id, client]));
        const upcoming = projects
          .filter((p) => OPEN_DELIVERY.includes(p.status) && p.due_date && daysUntil(p.due_date) !== null && daysUntil(p.due_date) <= 14)
          .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
          .map((project) => ({ ...project, client: clientsById[project.client_id] || null }));

        const costByProject = {};
        for (const c of costs) costByProject[c.project_id] = (costByProject[c.project_id] || 0) + Number(c.amount || 0);

        setData({ clients, projects, invoices, payments, costs, companyExpenses, activeProjects, lowStock, upcoming, costByProject });
      } catch (e) {
        setErr(e.message || 'تعذّر تحميل البيانات');
      }
    })();
    getDashboardMedia().then(setMedia).catch(() => {});
  }, []);

  async function onPickMedia(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setUploading(true);
    setMediaErr('');
    try {
      for (const file of files) {
        if (file.size > MAX_MEDIA_BYTES) {
          setMediaErr(`«${file.name}» يتجاوز الحد الأقصى (50 ميجابايت)`);
          continue;
        }
        const row = await uploadDashboardMedia(file);
        setMedia((m) => [row, ...m]);
      }
    } catch (uploadErr) {
      setMediaErr(uploadErr.message || 'تعذّر رفع الملف');
    } finally {
      setUploading(false);
    }
  }

  async function onDeleteMedia(item) {
    if (!confirm('حذف هذا المرفق نهائياً؟')) return;
    try {
      await removeDashboardMedia(item.id, item.file_path);
      setMedia((m) => m.filter((x) => x.id !== item.id));
    } catch (delErr) {
      setMediaErr(delErr.message || 'تعذّر الحذف');
    }
  }

  if (err) return <ErrorBar message={err} />;
  if (!data) return <Loading />;

  const days = PERIOD_DAYS[period];
  const periodRevenue = data.payments
    .filter((payment) => withinDays(payment.paid_at, days))
    .reduce((s, payment) => s + Number(payment.amount || 0), 0);
  const periodProjectCosts = data.costs.filter((c) => withinDays(c.work_date || c.created_at, days)).reduce((s, c) => s + Number(c.amount || 0), 0);
  const periodCompanyExpenses = data.companyExpenses.filter((e) => e.payment_status === 'paid' && withinDays(e.expense_date, days)).reduce((s, e) => s + Number(e.amount || 0), 0);
  const periodProfit = periodRevenue - periodProjectCosts - periodCompanyExpenses;
  const periodMargin = periodRevenue > 0 ? Math.round((periodProfit / periodRevenue) * 100) : 0;
  // يفضَّل تاريخ أول تواصل الحقيقي؛ created_at يعكس تاريخ الإدخال لا اكتساب العميل
  const periodNewClients = data.clients.filter((c) => withinDays(c.first_contact_at || c.created_at, days)).length;

  // إيرادات الفواتير المدفوعة لآخر 6 أشهر تقويمية
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return { year: d.getFullYear(), month: d.getMonth(), label: ARABIC_MONTHS[d.getMonth()] };
  });
  const monthTotals = months.map((m) => data.payments
    .filter((payment) => {
      const d = new Date(payment.paid_at);
      return d.getFullYear() === m.year && d.getMonth() === m.month;
    })
    .reduce((s, payment) => s + Number(payment.amount || 0), 0));
  const maxMonth = Math.max(...monthTotals, 1);

  // توزيع مصدر العملاء الفعلي
  const bySource = {};
  for (const c of data.clients) { const key = c.source || 'other'; bySource[key] = (bySource[key] || 0) + 1; }
  const totalClients = data.clients.length || 1;
  const sourceRows = Object.entries(bySource)
    .map(([key, count]) => ({ label: SOURCE_LABEL[key] || key, pct: Math.round((count / totalClients) * 100), count }))
    .sort((a, b) => b.count - a.count);

  return (
    <>
      <div className="sec-head"><h2>تسليمات قادمة</h2><span className="more">العدّ التنازلي للمواعيد</span></div>
      <div className="countdowns">
        {data.upcoming.slice(0, 4).map((item) => {
          const n = daysUntil(item.due_date);
          const clientMeta = [item.client?.name, item.client?.district].filter(Boolean).join(' · ');
          return (
            <div className="cdcard" key={item.id}>
              <div className="ring"><b>{n === null ? '—' : n < 0 ? fmtNum(-n) : fmtNum(n)}</b><span>{n < 0 ? 'متأخر' : 'يوم'}</span></div>
              <div className="cdbody">
                <div className={`cdttl${n !== null && n <= 3 ? ' urgent' : ''}`}>{n < 0 ? `متأخر ${fmtNum(-n)} يوم` : n === 0 ? 'اليوم' : `خلال ${fmtNum(n)} يوم`}</div>
                <small>{item.title}</small>
                {clientMeta && <small className="cdmeta">{clientMeta}</small>}
              </div>
            </div>
          );
        })}
        {data.upcoming.length === 0 && (
          <div className="cdcard"><div className="ring"><b>0</b><span>يوم</span></div><div><div className="cdttl">لا تسليمات قريبة</div><small>لا مشاريع مستحقة خلال 14 يوماً</small></div></div>
        )}
      </div>

      <div className="sec-head" style={{ marginBottom: 14 }}>
        <h2>مؤشرات الأداء</h2>
        <div className="viewtoggle" style={{ marginInlineStart: 'auto' }}>
          {[['day', 'يوم'], ['week', 'أسبوع'], ['month', 'شهر'], ['year', 'سنة']].map(([key, label]) => (
            <button className={`vt${period === key ? ' active' : ''}`} key={key} onClick={() => setPeriod(key)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(6,minmax(0,1fr))' }}>
        <KpiCard label={PERIOD_LABEL[period]} value={<><AnimatedNumber value={periodRevenue} format={fmtMoney} /> ⃁</>} trend="فواتير مدفوعة خلال الفترة" definition="مجموع الدفعات المسجلة على الفواتير غير المرتجعة خلال الفترة المختارة." period={PERIOD_SCOPE[period]} formula="جمع مبالغ دفعات الفواتير بتاريخ الدفع" breakdown={[{ label: 'عدد الدفعات', value: fmtNum(data.payments.filter((p) => withinDays(p.paid_at, days)).length) }, { label: 'إجمالي المحصّل', value: `${fmtMoney(periodRevenue)} ⃁` }]} />
        <KpiCard tone="pos" label="صافي الربح النقدي" value={<><AnimatedNumber value={periodProfit} format={fmtMoney} /> ⃁</>} trend="المحصّل بعد تكاليف المشاريع والشركة" definition="ما تبقّى من الإيرادات المحصّلة فعليًا بعد خصم المصاريف المدفوعة في الفترة نفسها." period={PERIOD_SCOPE[period]} formula="الإيرادات المحصّلة − تكاليف المشاريع − مصاريف الشركة المدفوعة" breakdown={[{ label: 'الإيرادات المحصّلة', value: `${fmtMoney(periodRevenue)} ⃁` }, { label: 'تكاليف المشاريع', value: `− ${fmtMoney(periodProjectCosts)} ⃁` }, { label: 'مصاريف الشركة', value: `− ${fmtMoney(periodCompanyExpenses)} ⃁` }]} note="قد يختلف عن الربح المحاسبي إذا كانت هناك فواتير أو مصاريف لم تُدفع بعد." />
        <KpiCard label="هامش الربح" value={<><AnimatedNumber value={periodMargin} format={fmtNum} />%</>} trend="من الإيرادات المحصّلة" definition="نسبة صافي الربح النقدي إلى الإيرادات المحصّلة خلال الفترة." period={PERIOD_SCOPE[period]} formula="صافي الربح النقدي ÷ الإيرادات المحصّلة × 100" breakdown={[{ label: 'صافي الربح', value: `${fmtMoney(periodProfit)} ⃁` }, { label: 'الإيرادات', value: `${fmtMoney(periodRevenue)} ⃁` }]} />
        <KpiCard label="العملاء الجدد" value={<AnimatedNumber value={periodNewClients} format={fmtNum} />} trend="خلال الفترة المختارة" definition="عدد العملاء الذين كان أول تواصل معهم أو تاريخ إضافتهم ضمن الفترة المختارة." period={PERIOD_SCOPE[period]} formula="عدّ سجلات العملاء ضمن الفترة" breakdown={[{ label: 'العملاء الجدد', value: fmtNum(periodNewClients) }, { label: 'إجمالي العملاء', value: fmtNum(data.clients.length) }]} />
        <KpiCard label="مشاريع نشطة" value={<AnimatedNumber value={data.activeProjects} format={fmtNum} />} trend={`${fmtNum(data.upcoming.length)} تسليم قريب`} definition="المشاريع التي حالتها عرض سعر أو قيد التحضير أو قيد التنفيذ." period="الحالة الحالية — لا تتأثر بفلتر الفترة" formula="عدّ المشاريع ذات الحالات النشطة" breakdown={[{ label: 'مشاريع نشطة', value: fmtNum(data.activeProjects) }, { label: 'تسليم خلال 14 يومًا أو متأخر', value: fmtNum(data.upcoming.length) }]} />
        <KpiCard tone="alert" label="تنبيهات المستودع" value={<AnimatedNumber value={data.lowStock.length} format={fmtNum} />} trend="أصناف وصلت حد النفاد" definition="عدد أصناف المخزون التي أصبحت كميتها أقل من حد إعادة الطلب المحدد لها." period="الحالة الحالية للمخزون" formula="عدّ الأصناف التي كميتها الحالية أقل من حد التنبيه" breakdown={data.lowStock.slice(0, 5).map((item) => ({ label: item.name, value: `${fmtNum(item.quantity)} / ${fmtNum(item.reorder_level)}` }))} note={data.lowStock.length > 5 ? `يظهر هنا أول 5 من أصل ${fmtNum(data.lowStock.length)} تنبيه.` : undefined} />
      </div>

      <div className="grid2">
        <div className="card">
          <div className="sec-head"><h2>الإيرادات المحصّلة</h2><span className="more">آخر 6 أشهر</span></div>
          <div className="bars">
            {months.map((m, i) => {
              const val = monthTotals[i];
              const pct = val > 0 ? Math.max(Math.round((val / maxMonth) * 100), 8) : 0;
              return (
                <div className={`bar${i === months.length - 1 ? ' cur' : ''}`} key={`${m.year}-${m.month}`} title={`${m.label}: ${fmtMoney(val)} ⃁`}>
                  <span className="bval">{val > 0 ? compactMoney(val) : ''}</span>
                  <div className="col"><div className="fill" style={{ height: `${pct}%` }} /></div>
                  <small>{m.label}</small>
                </div>
              );
            })}
          </div>
        </div>
        <div className="card">
          <div className="sec-head"><h2>مصدر العملاء</h2></div>
          {sourceRows.length === 0 ? <Empty title="لا عملاء بعد" desc="أضف عملاء لعرض توزيع مصادرهم." /> : sourceRows.map((row, i) => (
            <div className="srcrow" key={row.label}><span style={{ width: 74 }}>{row.label}</span><div className="track"><div className="tf" style={{ width: `${row.pct}%`, background: SOURCE_COLORS[i % SOURCE_COLORS.length] }} /></div><span className="pct">{row.pct}%</span></div>
          ))}
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
                const clientMeta = [project.client?.name, project.client?.district].filter(Boolean).join(' · ');
                return (
                  <div className="alert-row clickable" key={project.id} onClick={() => router.push(`/projects/${project.id}`)} style={{ cursor: 'pointer' }}>
                    <span className="alert-main">
                      <span className="nm">{project.title}</span>
                      {clientMeta && <small>{clientMeta}</small>}
                    </span>
                    <span className={`pill ${st.cls}`}>{st.label}</span>
                    <span className="tag" style={{ color: n < 0 ? 'var(--neg)' : n <= 3 ? 'var(--gold)' : 'var(--muted)' }}>{n < 0 ? `متأخر ${fmtNum(-n)} يوم` : n === 0 ? 'اليوم' : `خلال ${fmtNum(n)} يوم`}</span>
                  </div>
                );
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

      {/* المرفقات والوسائط */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="sec-head">
          <h2>المرفقات والوسائط</h2>
          <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="more">{fmtNum(media.length)}</span>
            <label className={`btn sm${uploading ? ' disabled' : ''}`} htmlFor="dash-media-file">
              {uploading ? 'جارٍ الرفع…' : '+ صورة / فيديو'}
            </label>
            <input id="dash-media-file" type="file" accept="image/*,video/*" multiple hidden disabled={uploading} onChange={onPickMedia} />
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', margin: '-6px 0 12px' }}>
          صور ومقاطع فيديو محفوظة على الخادم — تبقى بعد التحديث · الحد الأقصى 50 ميجابايت للملف
        </div>
        {mediaErr && <div className="errbar">{mediaErr}</div>}
        {media.length === 0 ? (
          <Empty title="لا مرفقات بعد" desc="اضغط «+ صورة / فيديو» لإضافة أول مرفق." />
        ) : (
          <div className="media-grid">
            {media.map((item) => (
              <div className="media-item" key={item.id}>
                {item.kind === 'video' ? (
                  <video src={item.file_url} controls preload="metadata" />
                ) : (
                  <a href={item.file_url} target="_blank" rel="noreferrer">
                    <img src={item.file_url} alt={item.caption || 'مرفق'} loading="lazy" />
                  </a>
                )}
                <button className="media-del" type="button" onClick={() => onDeleteMedia(item)} aria-label="حذف المرفق">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
