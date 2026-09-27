'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { getClients, getProjects } from '@/lib/data';
import { fmtMoney, fmtNum } from '@/lib/format';
import { buildDistrictIndex, aggregateByDistrict } from '@/lib/heatmap/aggregate';
import { METRICS, buildColorScale, BUCKET_COLORS, EMPTY_COLOR, DEMAND_LABELS } from '@/lib/heatmap/colors';
import { Loading, Empty, ErrorBar } from '../ui';
import { KpiCard } from '@/components';

const RiyadhNeighborhoodMap = dynamic(() => import('./RiyadhNeighborhoodMap'), {
  ssr: false,
  loading: () => <div className="state"><div className="spinner" /></div>,
});

export default function HeatmapPage() {
  const router = useRouter();
  const [geojson, setGeojson] = useState(null);
  const [clients, setClients] = useState(null);
  const [projects, setProjects] = useState(null);
  const [err, setErr] = useState('');
  const [metricKey, setMetricKey] = useState('clients');
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    Promise.all([
      fetch('/riyadh-districts.geojson').then((r) => r.json()),
      getClients(),
      getProjects(),
    ])
      .then(([geo, c, p]) => { setGeojson(geo); setClients(c); setProjects(p); })
      .catch((e) => setErr(e.message || 'تعذّر تحميل البيانات'));
  }, []);

  const index = useMemo(() => (geojson ? buildDistrictIndex(geojson) : null), [geojson]);
  const statsById = useMemo(
    () => (index && clients && projects ? aggregateByDistrict({ clients, projects, index }) : new Map()),
    [index, clients, projects],
  );
  const metric = METRICS[metricKey];
  const scale = useMemo(
    () => buildColorScale(metricKey, [...statsById.values()].map((s) => metric.get(s))),
    [statsById, metricKey, metric],
  );

  const topDistricts = useMemo(
    () => [...statsById.entries()]
      .map(([id, s]) => ({ id, ...s }))
      .sort((a, b) => metric.get(b) - metric.get(a))
      .slice(0, 10),
    [statsById, metric],
  );

  // الإجماليات الحقيقية تُحسب من كامل السجلات، لا من الأحياء المطابَقة فقط،
  // حتى لا يختفي العملاء/المشاريع الذين ليس لعميلهم حي معروف من الأرقام العامة.
  // «mapped*» تُبقي شفافية كم منها أمكن توزيعه فعلياً على الخريطة.
  const totals = useMemo(() => {
    const rows = [...statsById.values()];
    const allClients = clients || [];
    const allProjects = projects || [];
    return {
      activeDistricts: rows.length,
      clients: allClients.length,
      projects: allProjects.length,
      revenue: allProjects.reduce((s, p) => s + Number(p.sale_price || 0), 0),
      mappedClients: rows.reduce((s, r) => s + r.clients, 0),
      mappedProjects: rows.reduce((s, r) => s + r.projects, 0),
      mappedRevenue: rows.reduce((s, r) => s + r.revenue, 0),
    };
  }, [statsById, clients, projects]);

  const selected = selectedId ? { id: selectedId, ...(statsById.get(selectedId) || { nameAr: geojson?.features.find((f) => f.properties.district_id === selectedId)?.properties.name_ar, clients: 0, projects: 0, revenue: 0, avgContract: 0 }) } : null;

  if (err) return <ErrorBar message={err} />;
  if (!geojson || !clients || !projects) return <Loading />;

  return (
    <>
      <div className="sec-head">
        <h2>كثافة الطلبات حسب أحياء الرياض</h2>
        <div className="viewtoggle" style={{ marginInlineStart: 'auto' }}>
          {Object.entries(METRICS).map(([key, m]) => (
            <button className={`vt${metricKey === key ? ' active' : ''}`} key={key} onClick={() => setMetricKey(key)}>{m.label}</button>
          ))}
        </div>
      </div>

      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <KpiCard label="أحياء فيها نشاط" value={fmtNum(totals.activeDistricts)} definition="عدد أحياء الرياض التي ارتبط بها عميل أو مشروع في البيانات الحالية." period="الحالة الحالية للخريطة" formula="عدّ الأحياء ذات السجلات المرتبطة" breakdown={topDistricts.slice(0, 5).map((d) => ({ label: d.nameAr, value: `${fmtNum(d.clients)} عميل` }))} />
        <KpiCard tone="pos" label="إجمالي العملاء" value={fmtNum(totals.clients)} definition="إجمالي عدد العملاء في النظام." period="كل العملاء" formula="عدّ كل سجلات العملاء" breakdown={[{ label: 'ظاهرون على الخريطة', value: fmtNum(totals.mappedClients) }, { label: 'بلا حي معروف', value: fmtNum(totals.clients - totals.mappedClients) }]} note={totals.clients > totals.mappedClients ? `${fmtNum(totals.clients - totals.mappedClients)} عميل بلا حي معروف لا يظهرون على الخريطة لكنهم ضمن هذا الإجمالي.` : undefined} />
        <KpiCard label="إجمالي المشاريع" value={fmtNum(totals.projects)} definition="إجمالي عدد المشاريع في النظام." period="كل المشاريع" formula="عدّ كل سجلات المشاريع" breakdown={[{ label: 'ظاهرة على الخريطة', value: fmtNum(totals.mappedProjects) }, { label: 'بلا حي معروف', value: fmtNum(totals.projects - totals.mappedProjects) }]} note={totals.projects > totals.mappedProjects ? `${fmtNum(totals.projects - totals.mappedProjects)} مشروع لعملاء بلا حي معروف لا تظهر على الخريطة لكنها ضمن هذا الإجمالي.` : undefined} />
        <KpiCard tone="alert" label="قيمة العقود" value={`${fmtMoney(totals.revenue)} ⃁`} definition="مجموع قيم عقود كل المشاريع في النظام." period="كل المشاريع" formula="جمع قيمة عقود كل المشاريع" breakdown={[{ label: 'موزّعة على الخريطة', value: `${fmtMoney(totals.mappedRevenue)} ⃁` }, { label: 'بلا حي معروف', value: `${fmtMoney(totals.revenue - totals.mappedRevenue)} ⃁` }, ...topDistricts.slice(0, 3).map((d) => ({ label: d.nameAr, value: `${fmtMoney(d.revenue)} ⃁` }))]} note={totals.revenue > totals.mappedRevenue ? 'يشمل قيمة عقود مشاريع لعملاء بلا حي معروف.' : undefined} />
      </div>

      <div className="hmwrap">
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ position: 'relative', height: 520 }}>
            <RiyadhNeighborhoodMap geojson={geojson} statsById={statsById} metric={metric} scale={scale} onSelect={setSelectedId} />
          </div>
          <div className="legend" style={{ padding: '12px 16px' }}>
            منخفض
            <span className="sw">
              <i style={{ background: EMPTY_COLOR }} />
              {BUCKET_COLORS.map((c) => <i key={c} style={{ background: c }} />)}
            </span>
            مرتفع جداً
          </div>
        </div>

        <div>
          {selected ? (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="sec-head"><h2>{selected.nameAr}</h2></div>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}><span>العملاء</span><b className="amt">{fmtNum(selected.clients)}</b></div>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}><span>المشاريع</span><b className="amt">{fmtNum(selected.projects)}</b></div>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}><span>قيمة العقود</span><b className="amt">{fmtMoney(selected.revenue)} ⃁</b></div>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}><span>متوسط العقد</span><b className="amt">{fmtMoney(selected.avgContract)} ⃁</b></div>
              <button className="btn ghost sm" style={{ width: '100%' }} onClick={() => router.push(`/clients?district=${encodeURIComponent(selected.nameAr.replace(/^حي /, ''))}`)}>
                تصفّح عملاء هذا الحي
              </button>
            </div>
          ) : (
            <div className="card" style={{ marginBottom: 16 }}>
              <Empty title="اختر حياً" desc="اضغط على أي حي بالخريطة لعرض تفاصيله." />
            </div>
          )}

          <div className="card">
            <div className="sec-head"><h2>أعلى الأحياء</h2><span className="more">{metric.label}</span></div>
            {topDistricts.length === 0 ? <Empty title="لا بيانات بعد" desc="أضف عملاء بأحياء الرياض لتظهر هنا." /> : (
              <div className="alert-list">
                {topDistricts.map((d) => (
                  <div className="alert-row clickable" key={d.id} onClick={() => setSelectedId(d.id)} style={{ cursor: 'pointer' }}>
                    <span className="nm">{d.nameAr}</span>
                    <span className="tag amt">
                      {DEMAND_LABELS[Math.max(0, Math.min(3, Math.round((metric.get(d) / (metric.get(topDistricts[0]) || 1)) * 3)))]}
                      {' · '}
                      {metric.kind === 'money' ? `${fmtMoney(metric.get(d))} ⃁` : fmtNum(metric.get(d))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
