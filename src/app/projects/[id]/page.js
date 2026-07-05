'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  getProject, getClient, getEmployees, getProjectFinancials,
  getProjectTasks, createProjectTask, updateProjectTask, removeProjectTask,
  getProjectTeam, addProjectTeam, removeProjectTeam,
  getProjectMedia, createProjectMedia, removeProjectMedia,
  getProjectCosts, createProjectCost, removeProjectCost,
} from '@/lib/data';
import { fmtMoney, fmtNum, fmtDate, PROJECT_STATUS, displayProgress } from '@/lib/format';
import { Loading, Empty, ErrorBar } from '../../ui';

const COST_KIND = { labor: 'عمالة', materials: 'مواد', transport: 'نقل', bonus: 'حوافز', other: 'أخرى' };
const MEDIA_KIND = { before: 'قبل', after: 'بعد', other: 'أخرى' };

export default function ProjectDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

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
        <div className="kpi"><div className="lbl">قيمة العقد</div><div className="val amt">{fmtMoney(project.sale_price)} ⃁</div></div>
        <div className="kpi"><div className="lbl">إجمالي التكاليف</div><div className="val amt">{fmtMoney(totalCost)} ⃁</div></div>
        <div className="kpi"><div className="lbl">صافي الربح</div><div className="val amt">{fmtMoney(netProfit)} ⃁</div></div>
        <div className="kpi"><div className="lbl">هامش الربح</div><div className="val amt">{fmtNum(marginPct)}%</div></div>
      </div>

      <div className="grid2">
        <TasksCard projectId={id} tasks={tasks} onChange={(t) => setD((s) => ({ ...s, tasks: t }))} />
        <TeamCard projectId={id} employees={employees} team={team} teamIds={teamIds}
          onChange={(t) => setD((s) => ({ ...s, team: t }))} />
      </div>

      <CostsCard projectId={id} costs={costs} onChange={refreshCosts} />
      <MediaCard projectId={id} media={media} onChange={(m) => setD((s) => ({ ...s, media: m }))} />
    </>
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
        project_id: projectId, kind: form.kind, label: form.label.trim() || null, amount: Number(form.amount) || 0,
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
        <table>
          <thead><tr><th>النوع</th><th>الوصف</th><th>المبلغ</th><th></th></tr></thead>
          <tbody>
            {costs.map((c) => (
              <tr key={c.id}>
                <td>{COST_KIND[c.kind] || c.kind}</td>
                <td>{c.label || '—'}</td>
                <td className="amt">{fmtMoney(c.amount)} ⃁</td>
                <td style={{ textAlign: 'left' }}><button className="x-btn" onClick={() => del(c)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
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
  const [form, setForm] = useState({ kind: 'before', file_url: '' });
  const [busy, setBusy] = useState(false);

  async function add(e) {
    e.preventDefault();
    if (!form.file_url.trim()) return;
    setBusy(true);
    try {
      const m = await createProjectMedia({ project_id: projectId, kind: form.kind, file_url: form.file_url.trim() });
      onChange([m, ...media]); setForm({ kind: 'before', file_url: '' });
    } finally { setBusy(false); }
  }
  async function del(m) { await removeProjectMedia(m.id); onChange(media.filter((x) => x.id !== m.id)); }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="sec-head"><h2>الصور (قبل / بعد)</h2><span className="more">{fmtNum(media.length)}</span></div>
      {media.length === 0 ? <Empty title="لا صور" desc="أضف رابط صورة قبل/بعد التنفيذ." /> : (
        <div className="media-grid">
          {media.map((m) => (
            <figure className="media-item" key={m.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.file_url} alt={MEDIA_KIND[m.kind] || m.kind} />
              <figcaption><span className={`pill ${m.kind === 'after' ? 'p-done' : 'p-quote'}`}>{MEDIA_KIND[m.kind] || m.kind}</span>
                <button className="x-btn" onClick={() => del(m)}>✕</button></figcaption>
            </figure>
          ))}
        </div>
      )}
      <form onSubmit={add} className="inline-add" style={{ marginTop: 12 }}>
        <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))} style={{ maxWidth: 110 }}>
          {Object.entries(MEDIA_KIND).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input placeholder="رابط الصورة (URL)" dir="ltr" value={form.file_url} onChange={(e) => setForm((f) => ({ ...f, file_url: e.target.value }))} />
        <button className="btn sm" disabled={busy}>إضافة</button>
      </form>
    </div>
  );
}
