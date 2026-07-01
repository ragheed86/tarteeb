'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  getProjects, getClients, updateProject,
  getProjectCosts, saveProjectCosts, estimateToCostRows, costRowsToEstimate,
} from '@/lib/data';
import { fmtMoney } from '@/lib/format';
import { Loading, Empty, ErrorBar } from '../ui';

const EMPTY_ESTIMATE = {
  workers_count: '', worker_hours: '', worker_rate: '',
  supervisors_count: '', supervisor_hours: '', supervisor_rate: '',
  materials_cost: '', transport_cost: '', other_cost: '',
};

function num(value) {
  return Number(value) || 0;
}

export default function CostPage() {
  const [state, setState] = useState(null); // { projects, byId }
  const [err, setErr] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [salePrice, setSalePrice] = useState('');
  const [estimate, setEstimate] = useState(EMPTY_ESTIMATE);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    Promise.all([getProjects(), getClients()])
      .then(([projects, clients]) => {
        const byId = Object.fromEntries(clients.map((c) => [c.id, c.name]));
        setState({ projects, byId });
        if (projects[0]) pick(projects[0], byId);
      })
      .catch((e) => setErr(e.message || 'تعذّر التحميل'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pick(p, byIdOverride) {
    const byId = byIdOverride || state?.byId || {};
    setSelected({ ...p, clientName: byId[p.client_id] || 'عميل غير معروف' });
    setQuery(`${p.title} · ${byId[p.client_id] || ''}`);
    setSalePrice(p.sale_price ?? '');
    setSaveMsg('');
    try {
      const costs = await getProjectCosts(p.id);
      setEstimate(costRowsToEstimate(costs));
    } catch {
      setEstimate(EMPTY_ESTIMATE);
    }
  }

  function setEstimateField(k, v) { setEstimate((f) => ({ ...f, [k]: v })); }

  const filtered = useMemo(() => {
    if (!state) return [];
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return state.projects.filter((p) => `${p.title} ${state.byId[p.client_id] || ''}`.toLowerCase().includes(q));
  }, [query, state]);

  const workerTotal = num(estimate.workers_count) * num(estimate.worker_hours) * num(estimate.worker_rate);
  const supervisorTotal = num(estimate.supervisors_count) * num(estimate.supervisor_hours) * num(estimate.supervisor_rate);
  const total = workerTotal + supervisorTotal + num(estimate.materials_cost) + num(estimate.transport_cost) + num(estimate.other_cost);
  const price = num(salePrice);
  const profit = price - total;
  const margin = price > 0 ? Math.round((profit / price) * 100) : 0;

  async function save() {
    if (!selected) return;
    setSaving(true); setSaveMsg('');
    try {
      const up = await updateProject(selected.id, { sale_price: price });
      await saveProjectCosts(selected.id, estimateToCostRows(estimate));
      setState((s) => ({ ...s, projects: s.projects.map((x) => (x.id === up.id ? up : x)) }));
      setSelected((s) => ({ ...s, sale_price: up.sale_price }));
      setSaveMsg('تم حفظ التكاليف');
    } catch (e) {
      setSaveMsg(e.message || 'تعذّر الحفظ');
    } finally {
      setSaving(false);
    }
  }

  if (err) return <ErrorBar message={err} />;
  if (!state) return <Loading />;
  if (state.projects.length === 0) {
    return <div className="card"><Empty title="لا توجد مشاريع بعد" desc="أنشئ مشروعاً من صفحة المشاريع أولاً لإدارة تكلفته هنا." /></div>;
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 240, position: 'relative' }}>
            <div className="fsearch" style={{ marginBottom: 0 }}>
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="اكتب اسم المشروع أو العميل لإدارة تكلفته..." />
            </div>
            <div className={`ac${query.trim() ? ' open' : ''}`}>
              {filtered.length === 0 ? (
                <div className="presult" style={{ color: 'var(--muted)', cursor: 'default' }}>لا يوجد مشروع مطابق</div>
              ) : filtered.map((p) => (
                <div className="presult" key={p.id} onClick={() => pick(p)}>
                  <span>{p.title} · {state.byId[p.client_id] || '—'}</span><span className="pa">اختيار +</span>
                </div>
              ))}
            </div>
          </div>
          <select className="fselect" value={selected?.id || ''} onChange={(e) => {
            const p = state.projects.find((x) => x.id === e.target.value);
            if (p) pick(p);
          }}>
            <option value="">— أو اختر من القائمة —</option>
            {state.projects.map((p) => <option key={p.id} value={p.id}>{p.title} · {state.byId[p.client_id] || '—'}</option>)}
          </select>
        </div>
      </div>

      {!selected ? (
        <div className="card"><Empty title="اختر مشروعاً" desc="ابحث عن مشروع أعلاه لعرض تكلفته وتعديلها." /></div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div className="uid">مشروع</div>
              <h2 style={{ fontFamily: 'var(--display)', fontSize: 18, fontWeight: 600 }}>{selected.title} · {selected.clientName}</h2>
            </div>
            <div className="field" style={{ marginInlineStart: 'auto', textAlign: 'start', marginBottom: 0 }}>
              <label>سعر البيع</label>
              <input
                type="number" min="0" step="0.01" value={salePrice} dir="ltr"
                onChange={(e) => setSalePrice(e.target.value)}
                style={{ fontFamily: 'var(--display)', fontSize: 20, fontWeight: 600, width: 160 }}
              />
            </div>
          </div>

          <div className="estimate-box" style={{ marginBottom: 16 }}>
            <div className="estimate-head">
              <h3>تفصيل تكلفة العمالة</h3>
              <span className="amt">{fmtMoney(workerTotal + supervisorTotal)} ⃁</span>
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
            </div>
          </div>

          <div className="costwrap">
            <div className="card">
              <div className="sec-head"><h2>تفصيل التكاليف</h2></div>
              <CostInput icon="📦" label="تكلفة المنتجات" value={estimate.materials_cost} onChange={(v) => setEstimateField('materials_cost', v)} />
              <CostInput icon="🚚" label="النقل" value={estimate.transport_cost} onChange={(v) => setEstimateField('transport_cost', v)} />
              <CostInput icon="✳️" label="أخرى" value={estimate.other_cost} onChange={(v) => setEstimateField('other_cost', v)} />
              <div className="cost-line" style={{ borderBottom: 0, fontWeight: 600 }}>
                <div className="lft" style={{ marginInlineStart: 41 }}>إجمالي التكلفة</div>
                <b style={{ color: 'var(--neg)' }}>{fmtMoney(total)} ⃁</b>
              </div>
            </div>
            <div>
              <div className="result">
                <div className="mg">صافي ربح المشروع</div>
                <div className="big">{fmtMoney(profit)} ⃁</div>
                <div className="mg">هامش الربح {margin}% · يُحتسب تلقائياً من البنود</div>
              </div>
              <div className="card waterfall">
                <div className="wf"><span className="wl">سعر البيع</span><div className="wbar" style={{ width: '100%', background: 'var(--sage)' }}>{fmtMoney(price)}</div></div>
                <div className="wf"><span className="wl">التكلفة</span><div className="wbar" style={{ width: `${price > 0 ? Math.round((total / price) * 100) : 0}%`, background: 'var(--neg)' }}>{fmtMoney(total)}</div></div>
                <div className="wf"><span className="wl">صافي الربح</span><div className="wbar" style={{ width: `${Math.max(price > 0 ? Math.round((profit / price) * 100) : 0, 0)}%`, background: 'var(--green)' }}>{fmtMoney(profit)}</div></div>
              </div>
              <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                <button className="btn" onClick={save} disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ التكاليف'}</button>
                {saveMsg && <span style={{ fontSize: 13, color: 'var(--muted)' }}>{saveMsg}</span>}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function CostInput({ icon, label, value, onChange }) {
  return (
    <div className="cost-line">
      <div className="lft"><div className="ic">{icon}</div>{label}</div>
      <input
        type="number" min="0" step="0.01" value={value} dir="ltr"
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 120, textAlign: 'end', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 8px', fontFamily: 'var(--body)' }}
      />
    </div>
  );
}
