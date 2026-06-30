'use client';
import { useEffect, useState } from 'react';
import { getProjects, getClients } from '@/lib/data';
import { fmtMoney, fmtNum, fmtDate, PROJECT_STATUS } from '@/lib/format';
import { Loading, Empty, ErrorBar } from '../ui';

export default function ProjectsPage() {
  const [state, setState] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [projects, clients] = await Promise.all([getProjects(), getClients()]);
        const byId = Object.fromEntries(clients.map((c) => [c.id, c.name]));
        setState({ projects, byId });
      } catch (e) {
        setErr(e.message || 'تعذّر التحميل');
      }
    })();
  }, []);

  if (err) return <ErrorBar message={err} />;
  if (!state) return <Loading />;

  const { projects, byId } = state;

  return (
    <>
      <div className="sec-head" style={{ marginBottom: 18 }}>
        <button className="btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          مشروع جديد
        </button>
        <span className="more" style={{ marginInlineStart: 'auto' }}>{fmtNum(projects.length)} مشروع</span>
      </div>

      {projects.length === 0 ? (
        <div className="card"><Empty title="لا توجد مشاريع بعد" desc="أنشئ أول مشروع لربطه بعميل وتتبّع تقدّمه." /></div>
      ) : (
        <div className="pgrid">
          {projects.map((p) => {
            const st = PROJECT_STATUS[p.status] || { label: p.status, cls: 'p-wait' };
            return (
              <div className="pcard" key={p.id}>
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
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
