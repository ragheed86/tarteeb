'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getProjects, getClients, getInvoices, createProject, updateProject, removeProject,
} from '@/lib/data';
import { fmtMoney, fmtNum, fmtDate, PROJECT_STATUS, displayProgress, progressForStatus, DONE_STATUSES } from '@/lib/format';
import { Loading, Empty, ErrorBar } from '../ui';

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
  start_date: '', due_date: '', progress: 0,
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

function calendarMeta(anchorDate) {
  const [year, month] = anchorDate.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  return {
    label: new Intl.DateTimeFormat('ar-SA-u-nu-latn', { month: 'long', year: 'numeric' }).format(first),
    emptyCells: first.getDay(),
    days: new Date(year, month, 0).getDate(),
    prefix: `${year}-${String(month).padStart(2, '0')}`,
  };
}

export default function ProjectsPage() {
  const router = useRouter();
  const [state, setState] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [view, setView] = useState('cards');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [showAll, setShowAll] = useState(false);

  async function load() {
    try {
      const [projects, clients, invoices] = await Promise.all([getProjects(), getClients(), getInvoices().catch(() => [])]);
      const byId = Object.fromEntries(clients.map((c) => [c.id, c.name]));
      // السعر النهائي = مجموع فواتير المشروع الصادرة (غير المسودّة)
      const finalByProject = {};
      for (const inv of invoices || []) {
        if (inv.project_id && inv.status && inv.status !== 'draft') {
          finalByProject[inv.project_id] = (finalByProject[inv.project_id] || 0) + Number(inv.total || 0);
        }
      }
      setState({ projects, clients, byId, finalByProject });
    } catch (e) { setErr(e.message || 'تعذّر التحميل'); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(1); }, [q, from, to, view]);

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
    if (!confirm(`حذف المشروع «${p.title}»؟`)) return;
    try { await removeProject(p.id); setState((s) => ({ ...s, projects: s.projects.filter((x) => x.id !== p.id) })); }
    catch (e2) { setErr(e2.message || 'تعذّر الحذف'); }
  }

  async function moveToStatus(projectId, status) {
    const current = state?.projects.find((x) => x.id === projectId);
    if (!current || current.status === status) return;
    try {
      const up = await updateProject(projectId, { status, progress: progressForStatus(status, current.progress) });
      setState((s) => ({ ...s, projects: s.projects.map((x) => (x.id === up.id ? up : x)) }));
    } catch (e2) { setErr(e2.message || 'تعذّر تحديث الحالة'); }
  }

  if (err) return <ErrorBar message={err} />;
  if (!state) return <Loading />;

  const { projects, clients, byId, finalByProject } = state;
  const clientsById = Object.fromEntries(clients.map((c) => [c.id, c]));
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
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageProjects = filtered.slice(pageStart, pageStart + PAGE_SIZE);
  const firstPageDate = pageProjects.find((p) => p.due_date || p.start_date)?.due_date
    || pageProjects.find((p) => p.due_date || p.start_date)?.start_date;
  const cal = calendarMeta(from || to || firstPageDate || isoLocal(new Date()));
  const resetCurrentMonth = () => {
    const next = currentMonthRange();
    setFrom(next.from);
    setTo(next.to);
  };
  const showAllProjects = () => {
    setFrom('');
    setTo('');
    setQ('');
  };
  const cols = [
    ['قيد التجهيز', ['quote', 'preparing'], 'preparing'],
    ['جاري التنفيذ', ['in_progress'], 'in_progress'],
    ['تم التسليم', ['delivered', 'completed'], 'delivered'],
  ];
  return (
    <>
      <div className="toolbar">
        <div className="viewtoggle">
          <button className={`vt${view === 'cards' ? ' active' : ''}`} onClick={() => setView('cards')}>بطاقات</button>
          <button className={`vt${view === 'kanban' ? ' active' : ''}`} onClick={() => setView('kanban')}>كانبان</button>
          <button className={`vt${view === 'calendar' ? ' active' : ''}`} onClick={() => setView('calendar')}>تقويم</button>
        </div>
        <div className="search" style={{ marginInlineStart: 0, width: 220 }}>
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
          <input placeholder="بحث بالمشروع أو العميل أو التاريخ…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>من</span>
        <input type="date" className="fdate" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>إلى</span>
        <input type="date" className="fdate" value={to} onChange={(e) => setTo(e.target.value)} />
        <button className="chip" onClick={resetCurrentMonth}>هذا الشهر</button>
        <button className={`chip${!from && !to && !q ? ' active' : ''}`} onClick={showAllProjects}>عرض كل المشاريع</button>
        <button className="btn" style={{ marginInlineStart: 'auto' }} onClick={openAdd}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          مشروع جديد
        </button>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', margin: '-4px 0 16px' }}>
        {!from && !to ? 'يعرض كل المشاريع' : 'يعرض المشاريع ضمن نطاق التاريخ المحدد'} · البحث يعمل باسم المشروع أو العميل أو التاريخ · {fmtNum(filtered.length)} نتيجة
      </div>

      {projects.length === 0 ? (
        <div className="card"><Empty title="لا توجد مشاريع بعد" desc="أنشئ أول مشروع لربطه بعميل وتتبّع تقدّمه." /></div>
      ) : view === 'cards' ? (
        <>
          <div className="sec-head"><h2>ملخص المشاريع</h2><span className="more">اضغط أي صف للتفاصيل</span></div>
          <div className="card" style={{ padding: '6px 0', overflowX: 'auto', marginBottom: 20 }}>
            <table>
              <thead><tr><th>المشروع</th><th>العميل</th><th>الحالة</th><th>تاريخ التسليم</th><th>السعر المبدئي</th><th>سعر البيع النهائي</th><th>التقدّم</th></tr></thead>
              <tbody>
              {pageProjects.map((p) => {
                  const st = PROJECT_STATUS[p.status] || { label: p.status, cls: 'p-wait' };
                  return (
                    <tr className="clickable" key={p.id} onClick={() => router.push(`/projects/${p.id}`)}>
                      <td className="nm">{p.title}</td>
                      <td>{byId[p.client_id] || 'عميل غير معروف'}</td>
                      <td onClick={(e) => e.stopPropagation()}>
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
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(p.due_date)}</td>
                      <td className="amt">{fmtMoney(p.sale_price)} ⃁</td>
                      <td className="amt">{finalByProject?.[p.id] ? `${fmtMoney(finalByProject[p.id])} ⃁` : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                      <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ width: 70, height: 6, background: 'var(--surface-2)', borderRadius: 6, overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${displayProgress(p)}%`, background: 'var(--green)', borderRadius: 6 }} /></span>{fmtNum(displayProgress(p))}%</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
                  <div className="row" style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn ghost sm" onClick={() => openEdit(p)}>تعديل</button>
                    <button className="btn ghost sm" style={{ color: 'var(--neg)' }} onClick={(e) => del(p, e)}>حذف</button>
                  </div>
                </div>
              </div>
            );
          })}
          </div>
        </>
      ) : view === 'kanban' ? (
        <div className="kanban">
          {cols.map(([title, statuses, dropStatus]) => {
            const rows = pageProjects.filter((p) => statuses.includes(p.status));
            return (
              <div
                className="kcol"
                key={title}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
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
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', p.id)}
                      onClick={() => router.push(`/projects/${p.id}`)}
                    >
                      <h4>{p.title}</h4>
                      <div className="km">{byId[p.client_id] || 'عميل غير معروف'} · {p.service_type || '—'}</div>
                      <div className="kf"><span className="chk">{fmtNum(displayProgress(p))}%</span><span className="kp">{fmtMoney(p.sale_price)} ⃁</span></div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <div className="calhead"><h3>{cal.label}</h3><span style={{ fontSize: 12.5, color: 'var(--muted)' }}>مواعيد التسليم والزيارات</span></div>
          <div className="cal-week"><div>الأحد</div><div>الإثنين</div><div>الثلاثاء</div><div>الأربعاء</div><div>الخميس</div><div>الجمعة</div><div>السبت</div></div>
          <div className="cal-grid">
            {Array.from({ length: cal.emptyCells }, (_, i) => <div className="cell empty" key={`e-${i}`} />)}
            {Array.from({ length: cal.days }, (_, i) => {
              const day = i + 1;
              const dayIso = `${cal.prefix}-${String(day).padStart(2, '0')}`;
              const events = pageProjects.filter((p) => (p.due_date || p.start_date || '') === dayIso);
              return (
                <div className="cell" key={day}>
                  <span className="dn">{day}</span>
                  {events.map((p) => <div className="cev prog" key={p.id} onClick={() => router.push(`/projects/${p.id}`)}>{p.title}</div>)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {projects.length > 0 && (
        <div className="pagination">
          <button className="btn ghost sm" type="button" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>السابق</button>
          <span>
            صفحة <b className="amt">{fmtNum(currentPage)}</b> من <b className="amt">{fmtNum(totalPages)}</b>
            {' '}· يظهر {fmtNum(pageProjects.length)} من {fmtNum(filtered.length)}
          </span>
          <button className="btn ghost sm" type="button" disabled={currentPage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>التالي</button>
        </div>
      )}

      {open && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <form className="modal-card project-modal" onSubmit={submit}>
            <div className="modal-head">
              <div><h2>{editing ? 'تعديل مشروع' : 'مشروع جديد'}</h2><p>ربط بعميل وتحديد حالة المشروع</p></div>
              <button className="icon-close" type="button" onClick={close} aria-label="إغلاق">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            {formErr && <div className="errbar">{formErr}</div>}
            <div className="project-form-stack">
              <section className="project-section">
                <div className="section-title">
                  <h3>بيانات المشروع</h3>
                  <span>العميل، الخدمة، الحالة، والتواريخ</span>
                </div>
                <div className="form-grid project-info-grid">
                  <div className="field span-2">
                    <label>عنوان المشروع</label>
                    <input value={form.title} onChange={(e) => set('title', e.target.value)} required autoFocus />
                  </div>
                  <div className="field">
                    <label>العميل</label>
                    <select value={form.client_id} onChange={(e) => set('client_id', e.target.value)} required>
                      <option value="" disabled>اختر عميلاً…</option>
                      {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>نوع الخدمة</label>
                    <input value={form.service_type} onChange={(e) => set('service_type', e.target.value)} placeholder="دواليب / مطبخ / نقل…" />
                  </div>
                  <div className="field">
                    <label>قيمة العقد (⃁)</label>
                    <input type="number" min="0" step="0.01" value={form.sale_price} onChange={(e) => set('sale_price', e.target.value)} dir="ltr" />
                  </div>
                  <div className="field">
                    <label>الحالة</label>
                    <select value={form.status} onChange={(e) => set('status', e.target.value)}>
                      {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>نسبة التقدّم (%)</label>
                    <input
                      type="number" min="0" max="100"
                      value={DONE_STATUSES.includes(form.status) ? 100 : form.progress}
                      onChange={(e) => set('progress', e.target.value)}
                      dir="ltr"
                      disabled={DONE_STATUSES.includes(form.status)}
                    />
                    {DONE_STATUSES.includes(form.status) && (
                      <small style={{ color: 'var(--muted)', fontSize: 12 }}>يُضبط تلقائياً على 100% عند التسليم أو الاكتمال</small>
                    )}
                  </div>
                  <div className="date-pair">
                    <div className="field">
                      <label>تاريخ البدء</label>
                      <input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} dir="ltr" />
                    </div>
                    <div className="field">
                      <label>موعد التسليم</label>
                      <input type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} dir="ltr" />
                    </div>
                  </div>
                </div>
              </section>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" type="button" onClick={close} disabled={saving}>إلغاء</button>
              <button className="btn" type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ المشروع'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
