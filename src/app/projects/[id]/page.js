'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  getProject, getClient, getEmployees, getProjectFinancials,
  getProjectTasks, createProjectTask, updateProjectTask, removeProjectTask,
  getProjectTeam, addProjectTeam, removeProjectTeam,
  getProjectMedia, uploadProjectMedia, removeProjectMedia, updateProject,
  getProjectCosts, createProjectCost, removeProjectCost, removeProject,
} from '@/lib/data';
import { fmtMoney, fmtNum, fmtDate, PROJECT_STATUS, displayProgress } from '@/lib/format';
import { isSupervisorLaborRow } from '@/lib/labor';
import { Loading, Empty, ErrorBar, DataTable, KpiCard } from '@/components';

const COST_KIND = { labor: 'عمالة', materials: 'مواد', transport: 'نقل', bonus: 'حوافز', other: 'أخرى' };
const MEDIA_KIND = { before: 'قبل', after: 'بعد', other: 'أخرى' };
const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|ogg)$/i;

function costDescription(cost) {
  if (cost.product_name) return cost.supplier_name ? `${cost.product_name} · ${cost.supplier_name}` : cost.product_name;
  if (cost.worker_name) return `${isSupervisorLaborRow(cost) ? 'إشراف' : 'عمالة'}: ${cost.worker_name}`;
  if (cost.note) return cost.note;
  return cost.label || '—';
}

function isVideoMedia(media) {
  return VIDEO_EXT_RE.test(media.file_url || '') || VIDEO_EXT_RE.test(media.file_path || '');
}

export default function ProjectDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function loadAll() {
    setErr('');
    try {
      const project = await getProject(id);
      const [client, employees, fin, tasks, team, media, costs] = await Promise.all([
        project.client_id ? getClient(project.client_id) : Promise.resolve(null),
        getEmployees(),
        getProjectFinancials(id).catch(() => null),
        getProjectTasks(id), getProjectTeam(id), getProjectMedia(id), getProjectCosts(id),
      ]);
      setD({ project, client, employees, fin, tasks, team, media, costs });
    } catch (e) { setErr(e.message || 'تعذّر تحميل المشروع'); }
  }
  useEffect(() => { loadAll(); }, [id]);

  async function refreshCosts() {
    const [fin, costs] = await Promise.all([getProjectFinancials(id).catch(() => null), getProjectCosts(id)]);
    setD((s) => ({ ...s, fin, costs }));
  }

  async function deleteCurrentProject() {
    if (deleting || !d?.project) return;
    if (!confirm(`هل أنت متأكد من حذف المشروع «${d.project.title}»؟\n\nسيتم حذف المهام والفريق والتكاليف والصور والمرفقات نهائياً. ستبقى الفواتير الصادرة محفوظة كسجلات مالية ولكن بدون ربط بالمشروع.\n\nلا يمكن التراجع عن هذا الإجراء.`)) return;
    setDeleting(true);
    setErr('');
    try {
      const result = await removeProject(id);
      if (result?.cleanupWarning) alert(`تم حذف المشروع، لكن تعذّر تنظيف بعض الملفات من التخزين: ${result.cleanupWarning}`);
      router.replace('/projects');
    } catch (e) {
      setErr(e.message || 'تعذّر حذف المشروع');
      setDeleting(false);
    }
  }

  if (err) return <ErrorBar message={err} />;
  if (!d) return <Loading />;

  const { project, client, employees, fin, tasks, team, media, costs } = d;
  const st = PROJECT_STATUS[project.status] || { label: project.status, cls: 'p-wait' };
  const supervisor = employees.find((e) => e.id === project.supervisor_id);
  const teamIds = new Set(team.map((t) => t.employee_id));
  const totalCost = fin ? fin.total_cost : costs.reduce((s, c) => s + Number(c.amount || 0), 0);
  const netProfit = fin ? fin.net_profit : Number(project.sale_price || 0) - totalCost;
  const marginPct = fin ? fin.margin_pct : (project.sale_price > 0 ? Math.round(netProfit / project.sale_price * 100) : 0);

  return (
    <>
      <button className="back-link" onClick={() => router.push('/projects')}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        رجوع للمشاريع
      </button>
      <button className="btn ghost" style={{ marginInlineStart: 10, marginBottom: 16 }} onClick={() => router.push(`/projects/${id}/report`)}>
        تقرير المصاريف PDF
      </button>
      <button className="btn ghost" style={{ marginInlineStart: 10, marginBottom: 16, color: 'var(--neg)' }} disabled={deleting} onClick={deleteCurrentProject}>
        {deleting ? 'جارٍ حذف المشروع…' : 'حذف المشروع'}
      </button>

      {/* رأس */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="sec-head" style={{ marginBottom: 10 }}>
          <h2>{project.title}</h2>
          <span className={`pill ${st.cls}`} style={{ marginInlineStart: 'auto' }}>{st.label}</span>
        </div>
        <div className="kv"><span className="k">العميل</span><span className="v">{client?.name || '—'}</span></div>
        <div className="kv"><span className="k">نوع الخدمة</span><span className="v">{project.service_type || '—'}</span></div>
        <div className="kv"><span className="k">المشرف</span><span className="v">{supervisor?.name || '—'}</span></div>
        <div className="kv"><span className="k">البدء / التسليم</span><span className="v">{fmtDate(project.start_date)} ← {fmtDate(project.due_date)}</span></div>
        <div className="kv"><span className="k">التقدّم</span><span className="v amt">{fmtNum(displayProgress(project))}%</span></div>
      </div>

      {/* المؤشرات المالية من view */}
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <KpiCard label="قيمة العقد" value={`${fmtMoney(project.sale_price)} ⃁`} definition="قيمة بيع المشروع المسجلة في بيانات المشروع." period="هذا المشروع" formula="قيمة العقد المتفق عليها" note="لا تعني بالضرورة أن كامل المبلغ تم تحصيله من العميل." />
        <KpiCard label="إجمالي التكاليف" value={`${fmtMoney(totalCost)} ⃁`} definition="مجموع جميع بنود التكلفة المرتبطة بهذا المشروع." period="هذا المشروع" formula="جمع العمالة والمواد والنقل والحوافز والتكاليف الأخرى" breakdown={costs.slice(0, 6).map((cost) => ({ label: costDescription(cost), value: `${fmtMoney(cost.amount)} ⃁` }))} note={costs.length > 6 ? `يظهر أول 6 بنود من أصل ${fmtNum(costs.length)}.` : undefined} />
        <KpiCard label="صافي الربح" value={`${fmtMoney(netProfit)} ⃁`} definition="الربح المتوقع للمشروع بعد خصم جميع تكاليفه المسجلة من قيمة العقد." period="هذا المشروع" formula="قيمة العقد − إجمالي التكاليف" breakdown={[{ label: 'قيمة العقد', value: `${fmtMoney(project.sale_price)} ⃁` }, { label: 'إجمالي التكاليف', value: `− ${fmtMoney(totalCost)} ⃁` }, { label: 'صافي الربح', value: `${fmtMoney(netProfit)} ⃁` }]} />
        <KpiCard label="هامش الربح" value={`${fmtNum(marginPct)}%`} definition="النسبة التي يمثلها صافي الربح من قيمة عقد المشروع." period="هذا المشروع" formula="صافي الربح ÷ قيمة العقد × 100" breakdown={[{ label: 'صافي الربح', value: `${fmtMoney(netProfit)} ⃁` }, { label: 'قيمة العقد', value: `${fmtMoney(project.sale_price)} ⃁` }]} />
      </div>

      <div className="grid2">
        <DatesCard project={project} onChange={(p) => setD((s) => ({ ...s, project: p }))} />
        <TasksCard projectId={id} tasks={tasks} onChange={(t) => setD((s) => ({ ...s, tasks: t }))} />
      </div>

      <div className="grid2">
        <TeamCard projectId={id} employees={employees} team={team} teamIds={teamIds}
          onChange={(t) => setD((s) => ({ ...s, team: t }))} />
        <MediaCard projectId={id} media={media} onChange={(m) => setD((s) => ({ ...s, media: m }))} />
      </div>

      <CostsCard projectId={id} costs={costs} onChange={refreshCosts} />
    </>
  );
}

// ---------- التواريخ ----------
function DatesCard({ project, onChange }) {
  const [form, setForm] = useState({ start_date: project.start_date || '', due_date: project.due_date || '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function save(e) {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      const updated = await updateProject(project.id, {
        start_date: form.start_date || null,
        due_date: form.due_date || null,
      });
      onChange(updated);
      setMsg('تم حفظ التواريخ');
    } catch (err) {
      setMsg(err.message || 'تعذّر حفظ التواريخ');
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="sec-head"><h2>تواريخ المشروع</h2><span className="more">{fmtDate(project.start_date)} ← {fmtDate(project.due_date)}</span></div>
      {msg && <div className={msg.startsWith('تم') ? 'okbar' : 'errbar'}>{msg}</div>}
      <form onSubmit={save} className="form-grid">
        <div className="field"><label>تاريخ البدء</label><input type="date" lang="en-GB" dir="ltr" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} /></div>
        <div className="field"><label>تاريخ التسليم</label><input type="date" lang="en-GB" dir="ltr" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} /></div>
        <div className="modal-actions" style={{ gridColumn: '1 / -1' }}>
          <button className="btn sm" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ التواريخ'}</button>
        </div>
      </form>
    </div>
  );
}

// ---------- المهام ----------
function TasksCard({ projectId, tasks, onChange }) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      const t = await createProjectTask({ project_id: projectId, title: title.trim(), sort_order: tasks.length });
      onChange([...tasks, t]); setTitle('');
    } finally { setBusy(false); }
  }
  async function toggle(t) {
    const up = await updateProjectTask(t.id, { done: !t.done });
    onChange(tasks.map((x) => (x.id === up.id ? up : x)));
  }
  async function del(t) {
    await removeProjectTask(t.id);
    onChange(tasks.filter((x) => x.id !== t.id));
  }
  const done = tasks.filter((t) => t.done).length;

  return (
    <div className="card">
      <div className="sec-head"><h2>المهام</h2><span className="more">{fmtNum(done)}/{fmtNum(tasks.length)}</span></div>
      {tasks.length === 0 ? <Empty title="لا مهام" desc="أضف أول مهمة." /> : (
        <div className="checklist">
          {tasks.map((t) => (
            <div className="check-row" key={t.id}>
              <label>
                <input type="checkbox" checked={t.done} onChange={() => toggle(t)} />
                <span className={t.done ? 'done' : ''}>{t.title}</span>
              </label>
              <button className="x-btn" onClick={() => del(t)} aria-label="حذف">✕</button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={add} className="inline-add">
        <input placeholder="مهمة جديدة…" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="btn sm" disabled={busy}>إضافة</button>
      </form>
    </div>
  );
}

// ---------- الفريق ----------
function TeamCard({ projectId, employees, team, teamIds, onChange }) {
  const [sel, setSel] = useState('');
  const available = employees.filter((e) => !teamIds.has(e.id));

  async function add() {
    if (!sel) return;
    await addProjectTeam(projectId, sel);
    onChange(await getProjectTeam(projectId)); setSel('');
  }
  async function remove(employeeId) {
    await removeProjectTeam(projectId, employeeId);
    onChange(await getProjectTeam(projectId));
  }

  return (
    <div className="card">
      <div className="sec-head"><h2>فريق العمل</h2><span className="more">{fmtNum(team.length)}</span></div>
      {team.length === 0 ? <Empty title="لا أعضاء" desc="أضف أعضاء الفريق." /> : (
        <div className="chips">
          {team.map((t) => (
            <span className="chip" key={t.employee_id}>
              {t.employees?.name || '—'}
              <button onClick={() => remove(t.employee_id)} aria-label="إزالة">✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="inline-add">
        <select value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="">اختر موظفاً…</option>
          {available.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <button className="btn sm" onClick={add} disabled={!sel}>إضافة</button>
      </div>
    </div>
  );
}

// ---------- التكاليف ----------
function CostsCard({ projectId, costs, onChange }) {
  const [form, setForm] = useState({ kind: 'labor', label: '', amount: '' });
  const [busy, setBusy] = useState(false);

  async function add(e) {
    e.preventDefault();
    if (!form.amount) return;
    setBusy(true);
    try {
      await createProjectCost({
        project_id: projectId, kind: form.kind, note: form.label.trim() || null, amount: Number(form.amount) || 0,
      });
      setForm({ kind: 'labor', label: '', amount: '' });
      await onChange();
    } finally { setBusy(false); }
  }
  async function del(c) { await removeProjectCost(c.id); await onChange(); }
  const total = costs.reduce((s, c) => s + Number(c.amount || 0), 0);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="sec-head"><h2>بنود التكلفة</h2><span className="more amt">الإجمالي {fmtMoney(total)} ⃁</span></div>
      {costs.length === 0 ? <Empty title="لا بنود تكلفة" desc="أضف بنود التكلفة لحساب الربح." /> : (
        <DataTable
          rows={costs}
          columns={[
            { key: 'kind', label: 'النوع', primary: true, render: (c) => COST_KIND[c.kind] || c.kind },
            { key: 'desc', label: 'الوصف', render: (c) => costDescription(c) },
            { key: 'amount', label: 'المبلغ', render: (c) => <span className="amt">{fmtMoney(c.amount)} ⃁</span> },
            { key: 'actions', label: '', align: 'left', render: (c) => <button className="x-btn" onClick={() => del(c)} aria-label="حذف البند">✕</button> },
          ]}
        />
      )}
      <form onSubmit={add} className="inline-add" style={{ marginTop: 12 }}>
        <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))} style={{ maxWidth: 130 }}>
          {Object.entries(COST_KIND).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input placeholder="الوصف" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
        <input type="number" min="0" step="0.01" placeholder="المبلغ" dir="ltr" style={{ maxWidth: 130 }}
          value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
        <button className="btn sm" disabled={busy}>إضافة</button>
      </form>
    </div>
  );
}

// ---------- الوسائط ----------
function MediaCard({ projectId, media, onChange }) {
  const [form, setForm] = useState({ kind: 'before', file: null });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function add(e) {
    e.preventDefault();
    const formEl = e.currentTarget;
    if (!form.file) { setErr('اختر صورة أو فيديو من الجهاز'); return; }
    setBusy(true); setErr('');
    try {
      const m = await uploadProjectMedia(projectId, form.kind, form.file);
      onChange([m, ...media]); setForm({ kind: 'before', file: null });
      formEl.reset();
    } catch (uploadErr) {
      setErr(uploadErr.message || 'تعذّر رفع الصورة');
    } finally { setBusy(false); }
  }
  async function del(m) { await removeProjectMedia(m.id, m.file_path); onChange(media.filter((x) => x.id !== m.id)); }

  return (
    <div className="card">
      <div className="sec-head"><h2>الصور (قبل / بعد)</h2><span className="more">{fmtNum(media.length)}</span></div>
      {err && <div className="errbar">{err}</div>}
      {media.length === 0 ? <Empty title="لا وسائط" desc="ارفع صور أو فيديو قبل/بعد التنفيذ." /> : (
        <div className="media-grid">
          {media.map((m) => (
            <figure className="media-item" key={m.id}>
              {isVideoMedia(m) ? (
                <video src={m.file_url} controls preload="metadata" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.file_url} alt={MEDIA_KIND[m.kind] || m.kind} />
              )}
              <figcaption><span className={`pill ${m.kind === 'after' ? 'p-done' : 'p-quote'}`}>{MEDIA_KIND[m.kind] || m.kind}</span>
                <button className="x-btn" onClick={() => del(m)} aria-label="حذف الصورة">✕</button></figcaption>
            </figure>
          ))}
        </div>
      )}
      <form onSubmit={add} className="inline-add" style={{ marginTop: 12 }}>
        <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))} style={{ maxWidth: 110 }}>
          {Object.entries(MEDIA_KIND).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input type="file" accept="image/*,video/*" onChange={(e) => setForm((f) => ({ ...f, file: e.target.files?.[0] || null }))} />
        <button className="btn sm" disabled={busy}>{busy ? 'جارٍ الرفع…' : 'رفع'}</button>
      </form>
    </div>
  );
}
