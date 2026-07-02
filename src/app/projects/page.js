'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getProjects, getClients, createProject, updateProject, removeProject,
  getProjectCosts, saveProjectCosts, estimateToCostRows, costRowsToEstimate,
  createProjectCost, removeProjectCost, splitManagedCosts,
} from '@/lib/data';
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

const COST_KIND = { labor: 'عمالة', materials: 'مواد', transport: 'نقل', bonus: 'حوافز', other: 'أخرى' };
const EMPTY_EXTRA_COST = { kind: 'labor', label: '', amount: '' };

const EMPTY = {
  title: '', client_id: '', service_type: '', sale_price: '', status: 'quote',
  start_date: '', due_date: '', progress: 0,
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
  const [extraCosts, setExtraCosts] = useState([]); // بنود تكلفة حرة: { id, kind, label, amount }
  const [extraForm, setExtraForm] = useState(EMPTY_EXTRA_COST);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [view, setView] = useState('cards');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    try {
      const [projects, clients] = await Promise.all([getProjects(), getClients()]);
      const byId = Object.fromEntries(clients.map((c) => [c.id, c.name]));
      setState({ projects, clients, byId });
    } catch (e) { setErr(e.message || 'تعذّر التحميل'); }
  }
  useEffect(() => { load(); }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function setEstimateField(k, v) { setEstimate((f) => ({ ...f, [k]: v })); }
  function setExtraField(k, v) { setExtraForm((f) => ({ ...f, [k]: v })); }

  function addExtraCost() {
    const amount = Number(extraForm.amount) || 0;
    if (amount <= 0) return;
    setExtraCosts((c) => [...c, { id: null, kind: extraForm.kind, label: extraForm.label.trim(), amount }]);
    setExtraForm(EMPTY_EXTRA_COST);
  }
  async function removeExtraCost(item) {
    if (item.id) {
      try { await removeProjectCost(item.id); } catch { /* تجاهل فشل الحذف */ }
    }
    setExtraCosts((c) => c.filter((x) => x !== item));
  }

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY, client_id: state?.clients[0]?.id || '' });
    setEstimate(EMPTY_ESTIMATE);
    setExtraCosts([]); setExtraForm(EMPTY_EXTRA_COST);
    setFormErr(''); setOpen(true);
  }
  async function openEdit(p) {
    setEditing(p);
    setForm({
      title: p.title || '', client_id: p.client_id || '', service_type: p.service_type || '',
      sale_price: p.sale_price ?? '', status: p.status || 'quote',
      start_date: p.start_date || '', due_date: p.due_date || '', progress: p.progress ?? 0,
    });
    setEstimate(EMPTY_ESTIMATE);
    setExtraCosts([]); setExtraForm(EMPTY_EXTRA_COST);
    setFormErr(''); setOpen(true);
    try {
      const costs = await getProjectCosts(p.id);
      const { managed, adhoc } = splitManagedCosts(costs);
      setEstimate(costRowsToEstimate(managed));
      setExtraCosts(adhoc.map((c) => ({ id: c.id, kind: c.kind, label: c.label || '', amount: c.amount })));
    } catch { /* تجاهل: تبقى بنود التكلفة فارغة إذا تعذّر التحميل */ }
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
      progress: Math.max(0, Math.min(100, Number(form.progress) || 0)),
    };
    try {
      let projectId;
      if (editing) {
        const up = await updateProject(editing.id, payload);
        setState((s) => ({ ...s, projects: s.projects.map((x) => (x.id === up.id ? up : x)) }));
        projectId = up.id;
      } else {
        const np = await createProject(payload);
        setState((s) => ({ ...s, projects: [np, ...s.projects] }));
        projectId = np.id;
      }
      await saveProjectCosts(projectId, estimateToCostRows(estimate));
      const newExtraCosts = extraCosts.filter((c) => !c.id);
      await Promise.all(newExtraCosts.map((c) => createProjectCost({
        project_id: projectId, kind: c.kind, label: c.label || null, amount: c.amount,
      })));
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
      const up = await updateProject(projectId, { status });
      setState((s) => ({ ...s, projects: s.projects.map((x) => (x.id === up.id ? up : x)) }));
    } catch (e2) { setErr(e2.message || 'تعذّر تحديث الحالة'); }
  }

  if (err) return <ErrorBar message={err} />;
  if (!state) return <Loading />;

  const { projects, clients, byId } = state;
  const term = q.trim().toLowerCase();
  const searched = projects.filter((p) => !term || `${p.title} ${byId[p.client_id] || ''}`.toLowerCase().includes(term));
  const filtered = searched.filter((p) => {
    const d = p.due_date || p.start_date || '';
    return (!from || d >= from) && (!to || d <= to);
  });
  const cols = [
    ['قيد التجهيز', ['quote', 'preparing'], 'preparing'],
    ['جاري التنفيذ', ['in_progress'], 'in_progress'],
    ['تم التسليم', ['delivered', 'completed'], 'delivered'],
  ];
  const workerTotal = num(estimate.workers_count) * num(estimate.worker_hours) * num(estimate.worker_rate);
  const supervisorTotal = num(estimate.supervisors_count) * num(estimate.supervisor_hours) * num(estimate.supervisor_rate);
  const estimateTotal = workerTotal + supervisorTotal + num(estimate.materials_cost) + num(estimate.transport_cost) + num(estimate.other_cost);
  const extraCostsTotal = extraCosts.reduce((s, c) => s + num(c.amount), 0);

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
          <input placeholder="بحث بعنوان المشروع أو العميل…" value={q} onChange={(e) => setQ(e.target.value)} />
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
                      <td className="amt">{fmtMoney(p.sale_price)} ⃁</td>
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
                    <span className="price amt">{fmtMoney(p.sale_price)} ⃁</span>
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
          {cols.map(([title, statuses, dropStatus]) => {
            const rows = searched.filter((p) => statuses.includes(p.status));
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
                      <div className="kf"><span className="chk">{fmtNum(p.progress || 0)}%</span><span className="kp">{fmtMoney(p.sale_price)} ⃁</span></div>
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
              const events = searched.filter((p) => Number((p.due_date || '').slice(8, 10)) === day);
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
                  <span className="amt">{fmtMoney(estimateTotal)} ⃁</span>
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
                    <b className="amt">{fmtMoney(workerTotal)} ⃁</b>
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
                    <b className="amt">{fmtMoney(supervisorTotal)} ⃁</b>
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

              <div className="estimate-box span-2">
                <div className="estimate-head">
                  <h3>بنود تكلفة إضافية</h3>
                  <span className="amt">{fmtMoney(extraCostsTotal)} ⃁</span>
                </div>
                {extraCosts.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    {extraCosts.map((c, i) => (
                      <div className="cost-line" key={c.id || `new-${i}`}>
                        <div className="lft">{COST_KIND[c.kind] || c.kind}{c.label ? ` · ${c.label}` : ''}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <b className="amt">{fmtMoney(c.amount)} ⃁</b>
                          <button type="button" className="x-btn" onClick={() => removeExtraCost(c)}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="inline-add">
                  <select value={extraForm.kind} onChange={(e) => setExtraField('kind', e.target.value)} style={{ maxWidth: 130 }}>
                    {Object.entries(COST_KIND).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <input placeholder="وصف (اختياري)" value={extraForm.label} onChange={(e) => setExtraField('label', e.target.value)} />
                  <input type="number" min="0" step="0.01" placeholder="المبلغ" dir="ltr" style={{ maxWidth: 120 }} value={extraForm.amount} onChange={(e) => setExtraField('amount', e.target.value)} />
                  <button type="button" className="btn sm" onClick={addExtraCost}>إضافة</button>
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
