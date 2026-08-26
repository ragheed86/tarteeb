'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getProjects, getClients, getInvoices, getEmployees, createProject, updateProject, removeProject,
} from '@/lib/data';
import { GREGORIAN_DATE_LOCALE, fmtMoney, fmtNum, fmtDate, fmtRelative, PROJECT_STATUS, displayProgress, progressForStatus, DONE_STATUSES } from '@/lib/format';
import { usePersistedState } from '@/lib/usePersistedState';
import { Loading, Empty, ErrorBar, Modal, DataTable, Input, Select } from '@/components';

const STATUS_OPTS = [
  { value: 'quote', label: 'عرض سعر' },
  { value: 'preparing', label: 'قيد التحضير' },
  { value: 'in_progress', label: 'قيد التنفيذ' },
  { value: 'delivered', label: 'تم التسليم' },
  { value: 'completed', label: 'مكتمل' },
  { value: 'cancelled', label: 'ملغي' },
];

const EMPTY = {
  title: '', client_id: '', service_type: '', sale_price: '', status: 'quote',
  start_date: '', due_date: '', progress: 0, supervisor_id: '',
};
const PAGE_SIZE = 10;

function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function currentMonthRange() {
  const now = new Date();
  return {
    from: isoLocal(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: isoLocal(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

function normalizeSearch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

function projectOverlapsRange(project, from, to) {
  if (!from && !to) return true;
  const start = project.start_date || project.due_date || '';
  const end = project.due_date || project.start_date || '';
  if (!start && !end) return false;
  if (from && end && end < from) return false;
  if (to && start && start > to) return false;
  return true;
}

// ── مساعدات التقويم ──
const WEEKDAYS_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const MONTH_LABEL = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(GREGORIAN_DATE_LOCALE, { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
};
function addMonthsIso(iso, n) {
  const [y, m] = iso.split('-').map(Number);
  return isoLocal(new Date(y, m - 1 + n, 1));
}
function addDaysIso(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoLocal(new Date(y, m - 1, d + n));
}
// مصفوفة 42 يوماً (6 أسابيع) تبدأ من أحد يسبق أول الشهر — تتضمّن أيام الشهرين المجاورين
function monthMatrix(anchorIso) {
  const [y, m] = anchorIso.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = new Date(y, m - 1, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}
// أيام الأسبوع (7) المحتوي للتاريخ المرجعي
function weekDays(anchorIso) {
  const [y, m, d] = anchorIso.split('-').map(Number);
  const base = new Date(y, m - 1, d);
  const sunday = new Date(y, m - 1, d - base.getDay());
  return Array.from({ length: 7 }, (_, i) => new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + i));
}
const WEEK_RANGE_LABEL = (anchorIso) => {
  const days = weekDays(anchorIso);
  const fmt = (dt) => new Intl.DateTimeFormat(GREGORIAN_DATE_LOCALE, { day: 'numeric', month: 'short' }).format(dt);
  return `${fmt(days[0])} — ${fmt(days[6])}`;
};
// أعمدة كانبان: [العنوان, الحالات المشمولة, الحالة عند الإفلات]
const KANBAN_COLS = [
  ['قيد التخطيط', ['quote', 'preparing'], 'preparing'],
  ['قيد الإنجاز', ['in_progress'], 'in_progress'],
  ['قيد المراجعة', ['delivered'], 'delivered'],
  ['مكتمل', ['completed'], 'completed'],
];

export default function ProjectsPage() {
  const router = useRouter();
  const [state, setState] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [formErr, setFormErr] = useState('');
  // محفوظة عبر sessionStorage — تنجو من إعادة تركيب الصفحة (Splash عند تجديد الجلسة)
  // ومن أي إعادة تحميل حقيقية لنفس التبويب، فلا يُفاجأ المستخدم بعودة الفلاتر لوضعها الافتراضي
  const [view, setView] = usePersistedState('projects:view', 'table');
  const [from, setFrom] = usePersistedState('projects:from', '');
  const [to, setTo] = usePersistedState('projects:to', '');
  const [q, setQ] = usePersistedState('projects:q', '');
  const [page, setPage] = usePersistedState('projects:page', 1);
  const [showAll, setShowAll] = usePersistedState('projects:showAll', true);
  const [calMode, setCalMode] = useState('month');
  const [calAnchor, setCalAnchor] = useState(() => isoLocal(new Date()));
  const [dragCol, setDragCol] = useState(null);

  async function load() {
    try {
      const [projects, clients, invoices, employees] = await Promise.all([
        getProjects(), getClients(), getInvoices().catch(() => []), getEmployees().catch(() => []),
      ]);
      const byId = Object.fromEntries(clients.map((c) => [c.id, c.name]));
      const employeesById = Object.fromEntries((employees || []).map((em) => [em.id, em]));
      // السعر النهائي = مجموع فواتير المشروع الصادرة النشطة (غير المسودّة وغير المرتجعة)
      const finalByProject = {};
      for (const inv of invoices || []) {
        if (inv.project_id && inv.status && inv.status !== 'draft' && inv.status !== 'refunded') {
          finalByProject[inv.project_id] = (finalByProject[inv.project_id] || 0) + Number(inv.total || 0);
        }
      }
      setState({ projects, clients, byId, finalByProject, employees: employees || [], employeesById });
    } catch (e) { setErr(e.message || 'تعذّر التحميل'); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(1); }, [q, from, to, view, showAll]);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY, client_id: state?.clients[0]?.id || '' });
    setFormErr(''); setOpen(true);
  }
  function openEdit(p) {
    setEditing(p);
    setForm({
      title: p.title || '', client_id: p.client_id || '', service_type: p.service_type || '',
      sale_price: p.sale_price ?? '', status: p.status || 'quote',
      start_date: p.start_date || '', due_date: p.due_date || '', progress: p.progress ?? 0,
      supervisor_id: p.supervisor_id || '',
    });
    setFormErr(''); setOpen(true);
  }
  function close() { if (!saving) { setOpen(false); setEditing(null); } }

  async function submit(e) {
    e.preventDefault();
    if (!form.title.trim()) { setFormErr('عنوان المشروع مطلوب'); return; }
    if (!form.client_id) { setFormErr('اختر العميل'); return; }
    setSaving(true); setFormErr('');
    const payload = {
      title: form.title.trim(),
      client_id: form.client_id,
      service_type: form.service_type.trim() || null,
      sale_price: Number(form.sale_price) || 0,
      status: form.status,
      start_date: form.start_date || null,
      due_date: form.due_date || null,
      progress: progressForStatus(form.status, form.progress),
      supervisor_id: form.supervisor_id || null,
    };
    try {
      if (editing) {
        const up = await updateProject(editing.id, payload);
        setState((s) => ({ ...s, projects: s.projects.map((x) => (x.id === up.id ? up : x)) }));
      } else {
        const np = await createProject(payload);
        setState((s) => ({ ...s, projects: [np, ...s.projects] }));
      }
      close();
    } catch (e2) { setFormErr(e2.message || 'تعذّر الحفظ'); }
    finally { setSaving(false); }
  }

  async function del(p, e) {
    e.stopPropagation();
    if (deletingId) return;
    if (!confirm(`هل أنت متأكد من حذف المشروع «${p.title}»؟\n\nسيتم حذف المهام والفريق والتكاليف والصور والمرفقات نهائياً. ستبقى الفواتير الصادرة محفوظة كسجلات مالية ولكن بدون ربط بالمشروع.\n\nلا يمكن التراجع عن هذا الإجراء.`)) return;
    setDeletingId(p.id);
    setErr('');
    try {
      const result = await removeProject(p.id);
      setState((s) => ({ ...s, projects: s.projects.filter((x) => x.id !== p.id) }));
      if (result?.cleanupWarning) alert(`تم حذف المشروع، لكن تعذّر تنظيف بعض الملفات من التخزين: ${result.cleanupWarning}`);
    }
    catch (e2) { setErr(e2.message || 'تعذّر الحذف'); }
    finally { setDeletingId(null); }
  }

  async function moveToStatus(projectId, status) {
    const current = state?.projects.find((x) => x.id === projectId);
    if (!current || current.status === status) return;
    // تحديث فوري متفائل ثم مزامنة مع الخادم
    const optimistic = { ...current, status, progress: progressForStatus(status, current.progress) };
    setState((s) => ({ ...s, projects: s.projects.map((x) => (x.id === projectId ? optimistic : x)) }));
    try {
      const up = await updateProject(projectId, { status, progress: optimistic.progress });
      setState((s) => ({ ...s, projects: s.projects.map((x) => (x.id === up.id ? up : x)) }));
    } catch (e2) {
      setState((s) => ({ ...s, projects: s.projects.map((x) => (x.id === projectId ? current : x)) }));
      setErr(e2.message || 'تعذّر تحديث الحالة');
    }
  }

  // سحب مشروع في التقويم لتغيير موعد التسليم
  async function updateDueDate(projectId, iso) {
    const current = state?.projects.find((x) => x.id === projectId);
    if (!current || current.due_date === iso) return;
    setState((s) => ({ ...s, projects: s.projects.map((x) => (x.id === projectId ? { ...x, due_date: iso } : x)) }));
    try {
      const up = await updateProject(projectId, { due_date: iso });
      setState((s) => ({ ...s, projects: s.projects.map((x) => (x.id === up.id ? up : x)) }));
    } catch (e2) {
      setState((s) => ({ ...s, projects: s.projects.map((x) => (x.id === projectId ? current : x)) }));
      setErr(e2.message || 'تعذّر تحديث التاريخ');
    }
  }

  if (err) return <ErrorBar message={err} />;
  if (!state) return <Loading />;

  const { projects, clients, byId, finalByProject, employees, employeesById } = state;
  const clientsById = Object.fromEntries(clients.map((c) => [c.id, c]));
  const supervisorName = (p) => employeesById?.[p.supervisor_id]?.name || '';
  const term = normalizeSearch(q);
  const hasQuery = term.length > 0;
  const hasDateFilter = Boolean(from || to);
  const isBrowsing = showAll || hasQuery || hasDateFilter;
  const filtered = isBrowsing ? projects.filter((p) => {
    const client = clientsById[p.client_id];
    const searchText = normalizeSearch([
      p.title,
      p.service_type,
      p.status,
      p.id,
      p.client_id,
      byId[p.client_id],
      client?.name,
      client?.code,
      client?.phone,
      client?.district,
      p.start_date,
      p.due_date,
      p.created_at,
      fmtDate(p.start_date),
      fmtDate(p.due_date),
      fmtDate(p.created_at),
    ].filter(Boolean).join(' '));
    return (!term || searchText.includes(term)) && projectOverlapsRange(p, from, to);
  }) : [];
  // ترتيب حسب آخر تحديث (الأحدث أولاً) — يخدم «آخر 10 مشاريع تم العمل عليها»
  filtered.sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageProjects = filtered.slice(pageStart, pageStart + PAGE_SIZE);
  const boardProjects = filtered; // كانبان والتقويم يعرضان كل المطابق دون ترقيم صفحات
  const resetCurrentMonth = () => {
    const next = currentMonthRange();
    setFrom(next.from);
    setTo(next.to);
  };
  const showAllProjects = () => {
    setFrom('');
    setTo('');
    setQ('');
    setShowAll(true);
  };
  const paginated = view === 'table' || view === 'cards';
  return (
    <>
      <div className="toolbar toolbar-viewrow project-viewbar">
        <div className="viewtoggle">
          <button className={`vt${view === 'table' ? ' active' : ''}`} onClick={() => setView('table')}>جدول</button>
          <button className={`vt${view === 'cards' ? ' active' : ''}`} onClick={() => setView('cards')}>بطاقات</button>
          <button className={`vt${view === 'kanban' ? ' active' : ''}`} onClick={() => setView('kanban')}>كانبان</button>
          <button className={`vt${view === 'calendar' ? ' active' : ''}`} onClick={() => setView('calendar')}>تقويم</button>
        </div>
        <button className="btn" onClick={openAdd}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          مشروع جديد
        </button>
      </div>
      <div className="toolbar project-filters">
        <div className="search project-search">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
          <input placeholder="بحث بالمشروع أو العميل أو التاريخ…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="project-date-grid">
          <label className="project-date-field">
            <span>من</span>
            <input type="date" lang="en-GB" dir="ltr" className="fdate" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="project-date-field">
            <span>إلى</span>
            <input type="date" lang="en-GB" dir="ltr" className="fdate" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div className="project-filter-actions">
          <button className="chip" onClick={resetCurrentMonth}>هذا الشهر</button>
          <button className={`chip${showAll ? ' active' : ''}`} onClick={showAllProjects}>عرض كل المشاريع</button>
        </div>
      </div>
      <div className="project-filter-note">
        {!isBrowsing ? 'ابحث عن مشروع أو عميل، أو اختر نطاق تاريخ، لعرض المشاريع' : hasDateFilter ? 'يعرض المشاريع ضمن نطاق التاريخ المحدد' : 'يعرض كل المشاريع'} · البحث يعمل باسم المشروع أو العميل أو التاريخ{isBrowsing ? ` · ${fmtNum(filtered.length)} نتيجة` : ''}
      </div>

      {projects.length === 0 ? (
        <div className="card"><Empty title="لا توجد مشاريع بعد" desc="أنشئ أول مشروع لربطه بعميل وتتبّع تقدّمه." /></div>
      ) : !isBrowsing ? (
        <div className="card">
          <Empty title="ابحث لعرض المشاريع" desc="استخدم مربع البحث أعلاه، أو حدّد نطاق تاريخ، أو اضغط «عرض كل المشاريع»." />
        </div>
      ) : view === 'table' ? (
        <>
          <div className="sec-head"><h2>آخر المشاريع تحديثاً</h2><span className="more">مرتّبة حسب آخر تحديث · اضغط أي صف للتفاصيل</span></div>
          <div className="card" style={{ padding: '6px 0' }}>
            <DataTable
              rows={pageProjects}
              onRowClick={(p) => router.push(`/projects/${p.id}`)}
              columns={[
                { key: 'title', label: 'المشروع', primary: true, render: (p) => <span className="nm">{p.title}<br /><span className="uid">{byId[p.client_id] || 'عميل غير معروف'}</span></span> },
                { key: 'supervisor', label: 'المسؤول', render: (p) => supervisorName(p) || <span style={{ color: 'var(--muted)' }}>—</span> },
                {
                  key: 'status', label: 'الحالة',
                  render: (p) => {
                    const st = PROJECT_STATUS[p.status] || { label: p.status, cls: 'p-wait' };
                    return (
                      <span onClick={(e) => e.stopPropagation()}>
                        <select
                          className={`status-select pill ${st.cls}`}
                          value={p.status || 'quote'}
                          onChange={(e) => moveToStatus(p.id, e.target.value)}
                          aria-label={`حالة ${p.title}`}
                        >
                          {Object.entries(PROJECT_STATUS).map(([value, meta]) => (
                            <option key={value} value={value}>{meta.label}</option>
                          ))}
                        </select>
                      </span>
                    );
                  },
                },
                { key: 'updated', label: 'آخر تحديث', hideMobile: true, render: (p) => <span style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }} title={fmtDate(p.updated_at)}>{fmtRelative(p.updated_at)}</span> },
                { key: 'due', label: 'تاريخ التسليم', render: (p) => <span style={{ whiteSpace: 'nowrap' }}>{fmtDate(p.due_date)}</span> },
                { key: 'sale_price', label: 'السعر المبدئي', render: (p) => <span className="amt">{fmtMoney(p.sale_price)} ⃁</span> },
                { key: 'final', label: 'سعر البيع النهائي', render: (p) => (finalByProject?.[p.id] ? <span className="amt">{fmtMoney(finalByProject[p.id])} ⃁</span> : <span style={{ color: 'var(--muted)' }}>—</span>) },
                {
                  key: 'progress', label: 'التقدّم',
                  render: (p) => (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 70, height: 6, background: 'var(--surface-2)', borderRadius: 6, overflow: 'hidden' }}>
                        <span style={{ display: 'block', height: '100%', width: `${displayProgress(p)}%`, background: 'var(--green)', borderRadius: 6 }} />
                      </span>
                      <span className="amt" dir="ltr">{fmtNum(displayProgress(p))}%</span>
                    </span>
                  ),
                },
                {
                  key: 'actions', label: 'الإجراءات',
                  render: (p) => (
                    <span style={{ display: 'inline-flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                      <button className="btn ghost sm" onClick={() => openEdit(p)}>تعديل</button>
                      <button className="btn ghost sm" style={{ color: 'var(--neg)' }} disabled={deletingId === p.id} onClick={(e) => del(p, e)}>
                        {deletingId === p.id ? 'جارٍ الحذف…' : 'حذف'}
                      </button>
                    </span>
                  ),
                },
              ]}
            />
          </div>
        </>
      ) : view === 'cards' ? (
        <div className="pgrid">
          {pageProjects.map((p) => {
            const st = PROJECT_STATUS[p.status] || { label: p.status, cls: 'p-wait' };
            return (
              <div className="pcard" key={p.id} onClick={() => router.push(`/projects/${p.id}`)} style={{ cursor: 'pointer' }}>
                <div className="ph">
                  <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 8.5h16.5a1.5 1.5 0 0 1 1.48 1.76l-1.2 7A1.5 1.5 0 0 1 18.3 18.5H5.7a1.5 1.5 0 0 1-1.48-1.24l-1.2-7A1.5 1.5 0 0 1 3 8.5Z" /></svg>
                </div>
                <div className="pb">
                  <h3>{p.title}</h3>
                  <div className="cl">{byId[p.client_id] || 'عميل غير معروف'} · {p.service_type || '—'}</div>
                  <div className="row">
                    <span className="price amt">{fmtMoney(p.sale_price)} ⃁</span>
                    <select
                      className={`status-select pill ${st.cls}`}
                      value={p.status || 'quote'}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => { e.stopPropagation(); moveToStatus(p.id, e.target.value); }}
                      aria-label={`حالة ${p.title}`}
                    >
                      {Object.entries(PROJECT_STATUS).map(([value, meta]) => (
                        <option key={value} value={value}>{meta.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="prog"><i style={{ width: `${displayProgress(p)}%` }} /></div>
                  <div className="row" style={{ color: 'var(--muted)', fontSize: 12 }}>
                    <span>التسليم: {fmtDate(p.due_date)}</span>
                    <span className="amt">{fmtNum(displayProgress(p))}%</span>
                  </div>
                  {supervisorName(p) && (
                    <div className="row" style={{ color: 'var(--muted)', fontSize: 12 }}><span>المسؤول: {supervisorName(p)}</span></div>
                  )}
                  <div className="row" style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn ghost sm" onClick={() => openEdit(p)}>تعديل</button>
                    <button className="btn ghost sm" style={{ color: 'var(--neg)' }} disabled={deletingId === p.id} onClick={(e) => del(p, e)}>{deletingId === p.id ? 'جارٍ الحذف…' : 'حذف'}</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : view === 'kanban' ? (
        <div className="kanban kanban-4">
          {KANBAN_COLS.map(([title, statuses, dropStatus]) => {
            const rows = boardProjects.filter((p) => statuses.includes(p.status));
            return (
              <div
                className={`kcol${dragCol === dropStatus ? ' drag-over' : ''}`}
                key={dropStatus}
                onDragOver={(e) => { e.preventDefault(); if (dragCol !== dropStatus) setDragCol(dropStatus); }}
                onDragLeave={(e) => { if (e.currentTarget === e.target) setDragCol(null); }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragCol(null);
                  const id = e.dataTransfer.getData('text/plain');
                  if (id) moveToStatus(id, dropStatus);
                }}
              >
                <div className="kh">{title}<span className="kc">{fmtNum(rows.length)}</span></div>
                <div className="kbody">
                  {rows.map((p) => (
                    <div
                      className="kcard"
                      key={p.id}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', p.id); e.currentTarget.classList.add('dragging'); }}
                      onDragEnd={(e) => { e.currentTarget.classList.remove('dragging'); setDragCol(null); }}
                      onClick={() => router.push(`/projects/${p.id}`)}
                    >
                      <h4>{p.title}</h4>
                      <div className="km">{byId[p.client_id] || 'عميل غير معروف'} · {p.service_type || '—'}</div>
                      <div className="kprog"><i style={{ width: `${displayProgress(p)}%` }} /></div>
                      <div className="kmeta">
                        <span>التسليم: {fmtDate(p.due_date)}</span>
                        {supervisorName(p) && <span>· {supervisorName(p)}</span>}
                      </div>
                      <div className="kf"><span className="chk">{fmtNum(displayProgress(p))}%</span><span className="kp">{fmtMoney(p.sale_price)} ⃁</span></div>
                    </div>
                  ))}
                  {rows.length === 0 && <div className="kempty">اسحب مشروعاً هنا</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card calwrap">
          <div className="cal-toolbar">
            <div className="cal-nav">
              <button className="cal-navbtn" type="button" aria-label="السابق" onClick={() => setCalAnchor((a) => (calMode === 'month' ? addMonthsIso(a, -1) : addDaysIso(a, -7)))}>‹</button>
              <button className="cal-navbtn" type="button" aria-label="التالي" onClick={() => setCalAnchor((a) => (calMode === 'month' ? addMonthsIso(a, 1) : addDaysIso(a, 7)))}>›</button>
              <button className="chip" type="button" onClick={() => setCalAnchor(isoLocal(new Date()))}>اليوم</button>
              <h3 className="cal-title">{calMode === 'month' ? MONTH_LABEL(calAnchor) : WEEK_RANGE_LABEL(calAnchor)}</h3>
            </div>
            <div className="viewtoggle cal-modetoggle">
              <button className={`vt${calMode === 'month' ? ' active' : ''}`} type="button" onClick={() => setCalMode('month')}>شهر</button>
              <button className={`vt${calMode === 'week' ? ' active' : ''}`} type="button" onClick={() => setCalMode('week')}>أسبوع</button>
            </div>
          </div>
          <div className="cal-week">{WEEKDAYS_AR.map((d) => <div key={d}>{d}</div>)}</div>
          <div className={`cal-grid${calMode === 'week' ? ' cal-grid-week' : ''}`}>
            {(calMode === 'month' ? monthMatrix(calAnchor) : weekDays(calAnchor)).map((dt) => {
              const iso = isoLocal(dt);
              const [ay, am] = calAnchor.split('-').map(Number);
              const isOther = calMode === 'month' && (dt.getFullYear() !== ay || dt.getMonth() + 1 !== am);
              const isToday = iso === isoLocal(new Date());
              const events = boardProjects.filter((p) => {
                const start = p.start_date || p.due_date;
                const end = p.due_date || p.start_date;
                if (!start || !end) return false;
                return iso >= start && iso <= end;
              });
              return (
                <div
                  className={`cell${isOther ? ' other-month' : ''}${isToday ? ' today' : ''}${dragCol === iso ? ' drag-over' : ''}`}
                  key={iso}
                  onDragOver={(e) => { e.preventDefault(); if (dragCol !== iso) setDragCol(iso); }}
                  onDragLeave={(e) => { if (e.currentTarget === e.target) setDragCol(null); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragCol(null);
                    const id = e.dataTransfer.getData('text/plain');
                    if (id) updateDueDate(id, iso);
                  }}
                >
                  <span className="dn">{fmtNum(dt.getDate())}</span>
                  {events.map((p) => {
                    const st = PROJECT_STATUS[p.status] || { cls: 'p-wait' };
                    return (
                      <div
                        className={`cev ${st.cls}`}
                        key={p.id}
                        draggable
                        onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData('text/plain', p.id); }}
                        onDragEnd={() => setDragCol(null)}
                        onClick={(e) => { e.stopPropagation(); router.push(`/projects/${p.id}`); }}
                        title={`${p.title} — ${byId[p.client_id] || 'عميل غير معروف'}`}
                      >
                        <span className="cev-client">{byId[p.client_id] || 'عميل غير معروف'}</span>
                        <span className="cev-title">{p.title}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {paginated && (
        <div className="pagination">
          <button className="btn ghost sm" type="button" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>السابق</button>
          <span>
            صفحة <b className="amt">{fmtNum(currentPage)}</b> من <b className="amt">{fmtNum(totalPages)}</b>
            {' '}· يظهر {fmtNum(pageProjects.length)} من {fmtNum(filtered.length)}
          </span>
          <button className="btn ghost sm" type="button" disabled={currentPage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>التالي</button>
        </div>
      )}

      <Modal
        open={open}
        onClose={close}
        size="lg"
        title={editing ? 'تعديل مشروع' : 'مشروع جديد'}
        subtitle="ربط بعميل وتحديد حالة المشروع"
        as="form"
        onSubmit={submit}
        footer={(
          <>
            <button className="btn ghost" type="button" onClick={close} disabled={saving}>إلغاء</button>
            <button className="btn" type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ المشروع'}</button>
          </>
        )}
      >
        {formErr && <div className="errbar">{formErr}</div>}
        <div className="project-form-stack">
          <section className="project-section">
            <div className="section-title">
              <h3>بيانات المشروع</h3>
              <span>العميل، الخدمة، الحالة، والتواريخ</span>
            </div>
            <div className="form-grid project-info-grid">
              <Input className="span-2" label="عنوان المشروع" value={form.title} onChange={(e) => set('title', e.target.value)} required autoFocus />
              <Select label="العميل" value={form.client_id} onChange={(e) => set('client_id', e.target.value)} required>
                <option value="" disabled>اختر عميلاً…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <Input label="نوع الخدمة" value={form.service_type} onChange={(e) => set('service_type', e.target.value)} placeholder="دواليب / مطبخ / نقل…" />
              <Input label="قيمة العقد (⃁)" ltr type="number" min="0" step="0.01" value={form.sale_price} onChange={(e) => set('sale_price', e.target.value)} />
              <Select label="الحالة" value={form.status} onChange={(e) => set('status', e.target.value)} options={STATUS_OPTS} />
              <Select label="المسؤول" value={form.supervisor_id} onChange={(e) => set('supervisor_id', e.target.value)}>
                <option value="">— بدون —</option>
                {(state?.employees || []).map((em) => <option key={em.id} value={em.id}>{em.name}</option>)}
              </Select>
              <Input
                label="نسبة التقدّم (%)"
                ltr type="number" min="0" max="100"
                value={DONE_STATUSES.includes(form.status) ? 100 : form.progress}
                onChange={(e) => set('progress', e.target.value)}
                disabled={DONE_STATUSES.includes(form.status)}
                hint={DONE_STATUSES.includes(form.status) ? 'يُضبط تلقائياً على 100% عند التسليم أو الاكتمال' : undefined}
              />
              <div className="date-pair">
                <Input label="تاريخ البدء" ltr type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
                <Input label="موعد التسليم" ltr type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
              </div>
            </div>
          </section>
        </div>
      </Modal>
    </>
  );
}
