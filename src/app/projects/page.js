'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getProjects, getClients, getEmployees, createProject, updateProject, removeProject } from '@/lib/data';
import { fmtMoney, fmtNum, fmtDate, PROJECT_STATUS } from '@/lib/format';
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
  supervisor_id: '', start_date: '', due_date: '', progress: 0,
};

const EMPTY_ESTIMATE = {
  workers_count: '',
  worker_hours: '',
  worker_rate: '',
  supervisors_count: '',
  supervisor_hours: '',
  supervisor_rate: '',
  materials_cost: '',
  transport_cost: '',
  other_cost: '',
};

function num(value) {
  return Number(value) || 0;
}

export default function ProjectsPage() {
  const router = useRouter();
  const [state, setState] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [estimate, setEstimate] = useState(EMPTY_ESTIMATE);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [view, setView] = useState('cards');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  async function load() {
    try {
      const [projects, clients, employees] = await Promise.all([getProjects(), getClients(), getEmployees()]);
      const byId = Object.fromEntries(clients.map((c) => [c.id, c.name]));
      setState({ projects, clients, employees, byId });
    } catch (e) { setErr(e.message || 'تعذّر التحميل'); }
  }
  useEffect(() => { load(); }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function setEstimateField(k, v) { setEstimate((f) => ({ ...f, [k]: v })); }

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY, client_id: state?.clients[0]?.id || '' });
    setEstimate(EMPTY_ESTIMATE);
    setFormErr(''); setOpen(true);
  }
  function openEdit(p) {
    setEditing(p);
    setForm({
      title: p.title || '', client_id: p.client_id || '', service_type: p.service_type || '',
      sale_price: p.sale_price ?? '', status: p.status || 'quote', supervisor_id: p.supervisor_id || '',
      start_date: p.start_date || '', due_date: p.due_date || '', progress: p.progress ?? 0,
    });
    setEstimate(EMPTY_ESTIMATE);
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
      supervisor_id: form.supervisor_id || null,
      start_date: form.start_date || null,
      due_date: form.due_date || null,
      progress: Math.max(0, Math.min(100, Number(form.progress) || 0)),
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

  if (err) return <ErrorBar message={err} />;
  if (!state) return <Loading />;

  const { projects, clients, employees, byId } = state;
  const filtered = projects.filter((p) => {
    const d = p.due_date || p.start_date || '';
    return (!from || d >= from) && (!to || d <= to);
  });
  const cols = [
    ['قيد التجهيز', ['quote', 'preparing']],
    ['جاري التنفيذ', ['in_progress']],
    ['تم التسليم', ['delivered', 'completed']],
  ];
  const workerTotal = num(estimate.workers_count) * num(estimate.worker_hours) * num(estimate.worker_rate);
  const supervisorTotal = num(estimate.supervisors_count) * num(estimate.supervisor_hours) * num(estimate.supervisor_rate);
  const estimateTotal = workerTotal + supervisorTotal + num(estimate.materials_cost) + num(estimate.transport_cost) + num(estimate.other_cost);

  return (
    <>
      <div className="toolbar">
        <div className="viewtoggle">
          <button className={`vt${view === 'cards' ? ' active' : ''}`} onClick={() => setView('cards')}>بطاقات</button>
          <button className={`vt${view === 'kanban' ? ' active' : ''}`} onClick={() => setView('kanban')}>كانبان</button>
          <button className={`vt${view === 'calendar' ? ' active' : ''}`} onClick={() => setView('calendar')}>تقويم</button>
        </div>
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>من</span>
        <input type="date" className="fdate" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>إلى</span>
        <input type="date" className="fdate" value={to} onChange={(e) => setTo(e.target.value)} />
        <button className="chip" onClick={() => { setFrom(''); setTo(''); }}>مسح</button>
        <button className="btn" style={{ marginInlineStart: 'auto' }} onClick={openAdd}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          مشروع جديد
        </button>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', margin: '-4px 0 16px' }}>اسحب المشاريع في كانبان أو التقويم لإعادة جدولتها · فلتر التواريخ يطبّق على طريقة البطاقات.</div>

      {projects.length === 0 ? (
        <div className="card"><Empty title="لا توجد مشاريع بعد" desc="أنشئ أول مشروع لربطه بعميل وتتبّع تقدّمه." /></div>
      ) : view === 'cards' ? (
        <>
          <div className="sec-head"><h2>ملخص المشاريع</h2><span className="more">اضغط أي صف للتفاصيل</span></div>
          <div className="card" style={{ padding: '6px 0', overflowX: 'auto', marginBottom: 20 }}>
            <table>
              <thead><tr><th>المشروع</th><th>العميل</th><th>الحالة</th><th>سعر البيع</th><th>التقدّم</th></tr></thead>
              <tbody>
                {filtered.map((p) => {
                  const st = PROJECT_STATUS[p.status] || { label: p.status, cls: 'p-wait' };
                  return (
                    <tr className="clickable" key={p.id} onClick={() => router.push(`/projects/${p.id}`)}>
                      <td className="nm">{p.title}</td>
                      <td>{byId[p.client_id] || 'عميل غير معروف'}</td>
                      <td><span className={`pill ${st.cls}`}>{st.label}</span></td>
                      <td className="amt">{fmtMoney(p.sale_price)} ر.س</td>
                      <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ width: 70, height: 6, background: 'var(--surface-2)', borderRadius: 6, overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${p.progress || 0}%`, background: 'var(--green)', borderRadius: 6 }} /></span>{fmtNum(p.progress || 0)}%</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pgrid">
          {filtered.map((p) => {
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
                    <span className="price amt">{fmtMoney(p.sale_price)} ر.س</span>
                    <span className={`pill ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="prog"><i style={{ width: `${p.progress || 0}%` }} /></div>
                  <div className="row" style={{ color: 'var(--muted)', fontSize: 12 }}>
                    <span>التسليم: {fmtDate(p.due_date)}</span>
                    <span className="amt">{fmtNum(p.progress || 0)}%</span>
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
          {cols.map(([title, statuses]) => {
            const rows = projects.filter((p) => statuses.includes(p.status));
            return (
              <div className="kcol" key={title}>
                <div className="kh">{title}<span className="kc">{fmtNum(rows.length)}</span></div>
                <div className="kbody">
                  {rows.map((p) => (
                    <div className="kcard" key={p.id} onClick={() => router.push(`/projects/${p.id}`)}>
                      <h4>{p.title}</h4>
                      <div className="km">{byId[p.client_id] || 'عميل غير معروف'} · {p.service_type || '—'}</div>
                      <div className="kf"><span className="chk">{fmtNum(p.progress || 0)}%</span><span className="kp">{fmtMoney(p.sale_price)} ر.س</span></div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <div className="calhead"><h3>يوليو 2026</h3><span style={{ fontSize: 12.5, color: 'var(--muted)' }}>مواعيد التسليم والزيارات</span></div>
          <div className="cal-week"><div>الأحد</div><div>الإثنين</div><div>الثلاثاء</div><div>الأربعاء</div><div>الخميس</div><div>الجمعة</div><div>السبت</div></div>
          <div className="cal-grid">
            {Array.from({ length: 3 }, (_, i) => <div className="cell empty" key={`e-${i}`} />)}
            {Array.from({ length: 31 }, (_, i) => {
              const day = i + 1;
              const events = projects.filter((p) => Number((p.due_date || '').slice(8, 10)) === day);
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

      {open && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <form className="modal-card" onSubmit={submit}>
            <div className="modal-head">
              <div><h2>{editing ? 'تعديل مشروع' : 'مشروع جديد'}</h2><p>ربط بعميل وتحديد حالة المشروع</p></div>
              <button className="icon-close" type="button" onClick={close} aria-label="إغلاق">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            {formErr && <div className="errbar">{formErr}</div>}
            <div className="form-grid">
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
                <label>قيمة العقد (ر.س)</label>
                <input type="number" min="0" step="0.01" value={form.sale_price} onChange={(e) => set('sale_price', e.target.value)} dir="ltr" />
              </div>
              <div className="field">
                <label>الحالة</label>
                <select value={form.status} onChange={(e) => set('status', e.target.value)}>
                  {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label>حجز المشرف</label>
                <select value={form.supervisor_id} onChange={(e) => set('supervisor_id', e.target.value)}>
                  <option value="">— بدون —</option>
                  {employees.map((em) => <option key={em.id} value={em.id}>{em.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>حالة المشروع (%)</label>
                <input type="number" min="0" max="100" value={form.progress} onChange={(e) => set('progress', e.target.value)} dir="ltr" />
              </div>
              <div className="field">
                <label>تاريخ البدء</label>
                <input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} dir="ltr" />
              </div>
              <div className="field">
                <label>موعد التسليم</label>
                <input type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} dir="ltr" />
              </div>
              <div className="estimate-box span-2">
                <div className="estimate-head">
                  <h3>جدول تقديري</h3>
                  <span className="amt">{fmtMoney(estimateTotal)} ر.س</span>
                </div>
                <div className="estimate-grid">
                  <div className="field">
                    <label>عدد العاملين</label>
                    <input type="number" min="0" step="1" value={estimate.workers_count} onChange={(e) => setEstimateField('workers_count', e.target.value)} dir="ltr" />
                  </div>
                  <div className="field">
                    <label>ساعات العامل</label>
                    <input type="number" min="0" step="0.5" value={estimate.worker_hours} onChange={(e) => setEstimateField('worker_hours', e.target.value)} dir="ltr" />
                  </div>
                  <div className="field">
                    <label>سعر الساعة</label>
                    <input type="number" min="0" step="0.01" value={estimate.worker_rate} onChange={(e) => setEstimateField('worker_rate', e.target.value)} dir="ltr" />
                  </div>
                  <div className="estimate-total">
                    <span>إجمالي العاملين</span>
                    <b className="amt">{fmtMoney(workerTotal)} ر.س</b>
                  </div>
                  <div className="field">
                    <label>عدد المشرفين</label>
                    <input type="number" min="0" step="1" value={estimate.supervisors_count} onChange={(e) => setEstimateField('supervisors_count', e.target.value)} dir="ltr" />
                  </div>
                  <div className="field">
                    <label>ساعات المشرف</label>
                    <input type="number" min="0" step="0.5" value={estimate.supervisor_hours} onChange={(e) => setEstimateField('supervisor_hours', e.target.value)} dir="ltr" />
                  </div>
                  <div className="field">
                    <label>سعر ساعة المشرف</label>
                    <input type="number" min="0" step="0.01" value={estimate.supervisor_rate} onChange={(e) => setEstimateField('supervisor_rate', e.target.value)} dir="ltr" />
                  </div>
                  <div className="estimate-total">
                    <span>إجمالي المشرفين</span>
                    <b className="amt">{fmtMoney(supervisorTotal)} ر.س</b>
                  </div>
                  <div className="field">
                    <label>تكلفة المنتجات</label>
                    <input type="number" min="0" step="0.01" value={estimate.materials_cost} onChange={(e) => setEstimateField('materials_cost', e.target.value)} dir="ltr" />
                  </div>
                  <div className="field">
                    <label>النقل</label>
                    <input type="number" min="0" step="0.01" value={estimate.transport_cost} onChange={(e) => setEstimateField('transport_cost', e.target.value)} dir="ltr" />
                  </div>
                  <div className="field">
                    <label>أخرى</label>
                    <input type="number" min="0" step="0.01" value={estimate.other_cost} onChange={(e) => setEstimateField('other_cost', e.target.value)} dir="ltr" />
                  </div>
                </div>
              </div>
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
