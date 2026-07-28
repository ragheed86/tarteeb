'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  getProjects, getClients, getSuppliers, getEmployees, updateProject,
  getProjectCosts, getProjectInvoices, saveProjectCosts, estimateToCostRows, costRowsToEstimate,
  getProjectCostAttachments, uploadProjectCostAttachment, removeProjectCostAttachment,
} from '@/lib/data';
import { fmtMoney, fmtNum, fmtDate, INVOICE_STATUS, PROJECT_STATUS, progressForStatus } from '@/lib/format';
import { Loading, Empty, ErrorBar } from '../ui';

function num(value) {
  return Number(value) || 0;
}

function cleanWorkerName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isFreelanceWorker(value) {
  const name = cleanWorkerName(value);
  return name.includes('فريلانسر') || name.includes('freelance') || name.includes('freelancer');
}

function defaultHourlyRateForWorker(value) {
  const name = cleanWorkerName(value);
  if (!name) return '';
  if (isFreelanceWorker(name)) return '20';
  if (name.includes('رغيد') || name.includes('ragheed') || name.includes('دلال') || name.includes('dalal')) return '200';
  if (name.includes('زين') || name.includes('zain')) return '400';
  return '';
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseISODate(value) {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDaysISO(value, days) {
  const d = parseISODate(value) || new Date();
  d.setDate(d.getDate() + days);
  return isoLocal(d);
}

function plannedProjectDays(project) {
  const start = project?.start_date || project?.due_date || isoLocal(new Date());
  const due = project?.due_date || start;
  const s = parseISODate(start);
  const e = parseISODate(due);
  const count = s && e ? Math.max(1, Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1) : 1;
  return Array.from({ length: count }, (_, i) => addDaysISO(start, i));
}

const emptyLabor = () => ({ id: makeId('labor'), workerCount: '', worker: '', hours: '', rate: '' });
const emptyProduct = () => ({ id: makeId('product'), product: '', supplierId: '', supplierName: '', purchasePrice: '', markupPercent: '', salePrice: '' });
const emptyMoney = (prefix) => ({ id: makeId(prefix), note: '', amount: '' });
const emptyDay = (date) => ({ date, laborRows: [emptyLabor()], productRows: [emptyProduct()], transportRows: [], otherRows: [] });

function normalizeDay(day) {
  return {
    date: day.date,
    laborRows: day.laborRows?.length ? day.laborRows.map((r) => ({
      ...emptyLabor(),
      ...r,
      workerCount: r.workerCount ?? r.count ?? r.qty ?? (r.person ? 1 : ''),
      worker: r.worker ?? r.person ?? '',
      id: r.id || makeId('labor'),
    })) : [emptyLabor()],
    productRows: day.productRows?.length ? day.productRows.map((r) => ({ ...emptyProduct(), ...r, id: r.id || makeId('product') })) : [emptyProduct()],
    transportRows: (day.transportRows || []).map((r) => ({ ...emptyMoney('transport'), ...r, id: r.id || makeId('transport') })),
    otherRows: (day.otherRows || []).map((r) => ({ ...emptyMoney('other'), ...r, id: r.id || makeId('other') })),
  };
}

function buildDailyRows(project, savedRows) {
  const savedByDate = new Map((savedRows || []).map((d) => [d.date, d]));
  const dates = new Set([...plannedProjectDays(project), ...(savedRows || []).map((d) => d.date)]);
  return Array.from(dates)
    .sort((a, b) => a.localeCompare(b))
    .map((date) => normalizeDay(savedByDate.get(date) || emptyDay(date)));
}

function calcDay(day) {
  const labor = (day.laborRows || []).reduce((s, r) => s + num(r.workerCount) * num(r.hours) * num(r.rate), 0);
  const productsCost = (day.productRows || []).reduce((s, r) => s + num(r.purchasePrice), 0);
  const productsSale = (day.productRows || []).reduce((s, r) => s + num(r.salePrice), 0);
  const transport = (day.transportRows || []).reduce((s, r) => s + num(r.amount), 0);
  const other = (day.otherRows || []).reduce((s, r) => s + num(r.amount), 0);
  return { labor, productsCost, productsSale, transport, other, total: labor + productsCost + transport + other };
}

function updateRow(rows, id, key, value, suppliers) {
  return rows.map((r) => {
    if (r.id !== id) return r;
    const next = { ...r, [key]: value };
    if (key === 'supplierId') {
      const supplier = suppliers.find((s) => s.id === value);
      next.supplierName = supplier?.name || '';
    }
    if (key === 'purchasePrice' || key === 'markupPercent' || key === 'supplierId') {
      const purchase = num(next.purchasePrice);
      const pct = num(next.markupPercent);
      next.salePrice = purchase > 0 ? String(Math.round((purchase * (1 + pct / 100)) * 100) / 100) : '';
    }
    return next;
  });
}

function updateLaborRow(rows, id, key, value) {
  return rows.map((r) => {
    if (r.id !== id) return r;
    const next = { ...r, [key]: value };
    if (key === 'worker') {
      if (value && !isFreelanceWorker(value)) next.workerCount = '1';
      const defaultRate = defaultHourlyRateForWorker(value);
      if (defaultRate) next.rate = defaultRate;
    }
    return next;
  });
}

export default function CostPage() {
  const [state, setState] = useState(null);
  const [err, setErr] = useState('');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [salePrice, setSalePrice] = useState('');
  const [dailyRows, setDailyRows] = useState([]);
  const [projectInvoices, setProjectInvoices] = useState([]);
  const [invoicePanelOpen, setInvoicePanelOpen] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachErr, setAttachErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    Promise.all([getProjects(), getClients(), getSuppliers(), getEmployees().catch(() => [])])
      .then(([projects, clients, suppliers, employees]) => {
        const byId = Object.fromEntries(clients.map((c) => [c.id, c.name]));
        setState({ projects, suppliers, employees: employees || [], byId });
        // تُفتح الصفحة فارغة: يبحث المستخدم عن المشروع بنفسه بدل اختيار أول مشروع تلقائياً
      })
      .catch((e) => setErr(e.message || 'تعذّر التحميل'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pick(project, stateOverride) {
    const source = stateOverride || state || {};
    const byId = source.byId || {};
    const suppliers = source.suppliers || [];
    setSelected({ ...project, clientName: byId[project.client_id] || 'عميل غير معروف' });
    setQuery(`${project.title} · ${byId[project.client_id] || ''}`);
    setSearchOpen(false);
    setSalePrice(project.sale_price ?? '');
    setSaveMsg('');
    setProjectInvoices([]);
    setAttachments([]);
    setAttachErr('');
    setInvoicePanelOpen(false);
    try {
      const [costs, invoices, files] = await Promise.all([
        getProjectCosts(project.id),
        getProjectInvoices(project.id).catch(() => []),
        getProjectCostAttachments(project.id).catch(() => []),
      ]);
      setProjectInvoices(invoices || []);
      setAttachments(files || []);
      const restored = costRowsToEstimate(costs);
      const rows = buildDailyRows(project, restored.dailyRows).map((day) => ({
        ...day,
        productRows: day.productRows.map((row) => {
          const supplier = suppliers.find((s) => s.name === row.supplierName);
          return { ...row, supplierId: row.supplierId || supplier?.id || '' };
        }),
      }));
      setDailyRows(rows);
    } catch {
      setDailyRows(buildDailyRows(project, []));
      setProjectInvoices([]);
    }
  }

  const filtered = useMemo(() => {
    if (!state) return [];
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return state.projects.filter((p) => `${p.title} · ${state.byId[p.client_id] || ''}`.toLowerCase().includes(q));
  }, [query, state]);

  function updateDay(date, updater) {
    setDailyRows((days) => days.map((day) => (day.date === date ? updater(day) : day)));
  }

  function updateLabor(date, id, key, value) {
    updateDay(date, (day) => ({ ...day, laborRows: updateLaborRow(day.laborRows, id, key, value) }));
  }

  function updateProduct(date, id, key, value) {
    updateDay(date, (day) => ({ ...day, productRows: updateRow(day.productRows, id, key, value, state.suppliers) }));
  }

  function updateMoney(date, group, id, key, value) {
    updateDay(date, (day) => ({ ...day, [group]: updateRow(day[group], id, key, value, state.suppliers) }));
  }

  function addDay() {
    setDailyRows((days) => {
      const last = days.at(-1)?.date || selected?.due_date || selected?.start_date || isoLocal(new Date());
      return [...days, emptyDay(addDaysISO(last, 1))];
    });
  }

  function addRow(date, group) {
    updateDay(date, (day) => ({
      ...day,
      [group]: [
        ...day[group],
        group === 'laborRows' ? emptyLabor() : group === 'productRows' ? emptyProduct() : emptyMoney(group === 'transportRows' ? 'transport' : 'other'),
      ],
    }));
  }

  function removeRow(date, group, id) {
    updateDay(date, (day) => ({ ...day, [group]: day[group].filter((r) => r.id !== id) }));
  }

  function removeDay(date) {
    setDailyRows((days) => days.filter((day) => day.date !== date));
  }

  const dayTotals = dailyRows.map((day) => ({ date: day.date, ...calcDay(day) }));
  const total = dayTotals.reduce((s, d) => s + d.total, 0);
  const price = num(salePrice);
  const profit = price - total;
  const margin = price > 0 ? Math.round((profit / price) * 100) : 0;
  const laborSummary = dailyRows.reduce((summary, day) => {
    let hasLabor = false;
    for (const row of day.laborRows || []) {
      const workers = num(row.workerCount);
      const rowHours = workers * num(row.hours);
      const amount = rowHours * num(row.rate);
      if (workers || rowHours || amount) hasLabor = true;
      summary.workerDays += workers;
      summary.hours += rowHours;
      summary.amount += amount;
    }
    if (hasLabor) summary.days += 1;
    return summary;
  }, { days: 0, workerDays: 0, hours: 0, amount: 0 });

  const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024; // حد Supabase الافتراضي 50 ميجابايت

  async function onUploadAttachments(fileList) {
    const files = Array.from(fileList || []);
    if (!selected || !files.length) return;
    setUploadingAttachment(true);
    setAttachErr('');
    try {
      for (const file of files) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          setAttachErr(`«${file.name}» يتجاوز الحد الأقصى (50 ميجابايت)`);
          continue;
        }
        const row = await uploadProjectCostAttachment(selected.id, file);
        setAttachments((current) => [row, ...current]);
      }
    } catch (e) {
      setAttachErr(e.message || 'تعذّر رفع المستند');
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function onDeleteAttachment(item) {
    if (!confirm(`حذف المستند «${item.file_name}»؟`)) return;
    try {
      await removeProjectCostAttachment(item.id, item.file_path);
      setAttachments((current) => current.filter((x) => x.id !== item.id));
    } catch (e) {
      setAttachErr(e.message || 'تعذّر حذف المستند');
    }
  }

  async function changeStatus(status) {
    if (!selected || status === selected.status) return;
    const prev = selected.status;
    const progress = progressForStatus(status, selected.progress);
    setSelected((s) => ({ ...s, status, progress }));
    setState((s) => ({ ...s, projects: s.projects.map((p) => (p.id === selected.id ? { ...p, status, progress } : p)) }));
    try {
      await updateProject(selected.id, { status, progress });
    } catch (e) {
      setSelected((s) => ({ ...s, status: prev, progress: selected.progress }));
      setState((s) => ({ ...s, projects: s.projects.map((p) => (p.id === selected.id ? { ...p, status: prev, progress: selected.progress } : p)) }));
      setSaveMsg(e.message || 'تعذّر تحديث الحالة');
    }
  }

  async function save() {
    if (!selected) return;
    setSaving(true); setSaveMsg('');
    try {
      const up = await updateProject(selected.id, { sale_price: price });
      await saveProjectCosts(selected.id, estimateToCostRows({ dailyRows }), { scope: 'daily' });
      setState((s) => ({ ...s, projects: s.projects.map((x) => (x.id === up.id ? up : x)) }));
      setSelected((s) => ({ ...s, sale_price: up.sale_price }));
      setSaveMsg('تم حفظ التكاليف اليومية');
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
      <div className="card cost-search-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 240, position: 'relative' }}>
            <div className="fsearch" style={{ marginBottom: 0 }}>
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                placeholder="اكتب اسم المشروع أو العميل لإدارة تكلفته..."
              />
            </div>
            <div className={`ac${searchOpen && query.trim() ? ' open' : ''}`}>
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
          <div className="daily-cost-summary">
            <div className="card">
              <div className="uid">مشروع</div>
              <h2>{selected.title} · {selected.clientName}</h2>
              <small>{fmtDate(selected.start_date)} إلى {fmtDate(selected.due_date)} · {fmtNum(dailyRows.length)} يوم عمل</small>
              <div style={{ marginTop: 12 }}>
                <label className="uid" style={{ display: 'block', marginBottom: 5 }}>حالة المشروع</label>
                <select
                  className={`status-select pill ${(PROJECT_STATUS[selected.status] || { cls: 'p-wait' }).cls}`}
                  value={selected.status || 'quote'}
                  onChange={(e) => changeStatus(e.target.value)}
                  aria-label="حالة المشروع"
                >
                  {Object.entries(PROJECT_STATUS).map(([value, meta]) => (
                    <option key={value} value={value}>{meta.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="card">
              <div className="field" style={{ marginBottom: 0 }}>
                <label>سعر البيع</label>
                <input type="number" min="0" step="0.01" value={salePrice} dir="ltr" onChange={(e) => setSalePrice(e.target.value)} />
              </div>
            </div>
            <div className="result">
              <div className="mg">صافي ربح المشروع</div>
              <div className="big">{fmtMoney(profit)} ⃁</div>
              <div className="mg">إجمالي التكلفة {fmtMoney(total)} ⃁ · هامش {margin}%</div>
            </div>
          </div>

          {(laborSummary.workerDays > 0 || laborSummary.hours > 0 || laborSummary.amount > 0) && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="sec-head"><h2>ملخص العمالة</h2><span className="more">{fmtNum(laborSummary.days)} يوم فيه عمالة</span></div>
              <div className="daily-people-grid">
                <div className="person-due">
                  <b>إجمالي العمال</b>
                  <span>{fmtNum(laborSummary.workerDays)} عامل/يوم</span>
                  <strong className="amt">{fmtMoney(laborSummary.amount)} ⃁</strong>
                </div>
                <div className="person-due">
                  <b>إجمالي الساعات</b>
                  <span>{fmtNum(laborSummary.hours)} ساعة محسوبة</span>
                  <strong className="amt">{fmtMoney(laborSummary.amount)} ⃁</strong>
                </div>
              </div>
            </div>
          )}

          <div className="daily-actions">
            <button className="btn" onClick={addDay} type="button">+ إضافة يوم عمل</button>
            <button className="btn ghost" onClick={() => setInvoicePanelOpen(true)} type="button">
              مرفقات الفواتير {(projectInvoices.length + attachments.length) ? `(${fmtNum(projectInvoices.length + attachments.length)})` : ''}
            </button>
            <button className="btn ghost" onClick={() => window.location.assign(`/projects/${selected.id}/report`)} type="button">تقرير PDF</button>
            <button className="btn ghost" onClick={save} disabled={saving} type="button">{saving ? 'جارٍ الحفظ…' : 'حفظ التكاليف اليومية'}</button>
            {saveMsg && <span>{saveMsg}</span>}
          </div>

          {invoicePanelOpen && (
            <InvoiceAttachmentsModal
              invoices={projectInvoices}
              attachments={attachments}
              uploading={uploadingAttachment}
              attachErr={attachErr}
              onUpload={onUploadAttachments}
              onDeleteAttachment={onDeleteAttachment}
              onClose={() => setInvoicePanelOpen(false)}
            />
          )}

          <div className="daily-cost-days">
            {dailyRows.map((day, index) => {
              const totals = calcDay(day);
              return (
                <section className="day-cost-card" key={day.date}>
                  <div className="day-cost-head">
                    <div>
                      <h3>اليوم {fmtNum(index + 1)}</h3>
                      <span>{fmtDate(day.date)}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <strong className="amt">{fmtMoney(totals.total)} ⃁</strong>
                      <button className="btn ghost sm" type="button" onClick={() => removeDay(day.date)}>حذف اليوم</button>
                    </div>
                  </div>

                  <DailyTable
                    title="العمالة"
                    total={totals.labor}
                    columns={['عدد العمال', 'الموظف (اختياري)', 'ساعات العامل', 'إجمالي الساعات', 'سعر الساعة', 'الإجمالي', '']}
                    headClass="labor-head"
                    onAdd={() => addRow(day.date, 'laborRows')}
                    addLabel="+ إضافة بند عمالة"
                  >
                    {day.laborRows.map((row) => (
                      <div className="daily-table-row labor-row" key={row.id}>
                        <span className="dcell" data-label="عدد العمال"><input type="number" min="0" step="1" value={row.workerCount} onChange={(e) => updateLabor(day.date, row.id, 'workerCount', e.target.value)} dir="ltr" aria-label="عدد العمال" /></span>
                        <span className="dcell" data-label="الموظف (اختياري)">
                          <select value={row.worker || ''} onChange={(e) => updateLabor(day.date, row.id, 'worker', e.target.value)} aria-label="الموظف">
                            <option value="">— بدون —</option>
                            {(state.employees || []).map((em) => <option key={em.id} value={em.name}>{em.name}</option>)}
                            {row.worker && row.worker !== 'فريلانسر' && !(state.employees || []).some((em) => em.name === row.worker) && (
                              <option value={row.worker}>{row.worker}</option>
                            )}
                            <option value="فريلانسر">فريلانسر (مستقل)</option>
                          </select>
                        </span>
                        <span className="dcell" data-label="ساعات العامل"><input type="number" min="0" step="0.5" value={row.hours} onChange={(e) => updateLabor(day.date, row.id, 'hours', e.target.value)} dir="ltr" aria-label="ساعات العامل" /></span>
                        <span className="dcell" data-label="إجمالي الساعات"><span className="row-total amt">{fmtNum(num(row.workerCount) * num(row.hours))}</span></span>
                        <span className="dcell" data-label="سعر الساعة"><input type="number" min="0" step="0.01" value={row.rate} onChange={(e) => updateLabor(day.date, row.id, 'rate', e.target.value)} dir="ltr" aria-label="سعر الساعة" /></span>
                        <span className="dcell" data-label="الإجمالي"><span className="row-total amt">{fmtMoney(num(row.workerCount) * num(row.hours) * num(row.rate))} ⃁</span></span>
                        <span className="dcell dcell-action"><button className="x-btn" type="button" onClick={() => removeRow(day.date, 'laborRows', row.id)} aria-label="حذف البند">✕</button></span>
                      </div>
                    ))}
                  </DailyTable>

                  <DailyTable
                    title="المنتجات"
                    total={totals.productsCost}
                    columns={['المنتج', 'المورد', 'سعر الشراء', 'نسبة البيع %', 'الإجمالي', '']}
                    headClass="product-head"
                    onAdd={() => addRow(day.date, 'productRows')}
                    addLabel="+ إضافة منتج"
                  >
                    {day.productRows.map((row) => (
                      <div className="daily-table-row product-row" key={row.id}>
                        <span className="dcell" data-label="المنتج"><input value={row.product} onChange={(e) => updateProduct(day.date, row.id, 'product', e.target.value)} placeholder="اسم المنتج" aria-label="المنتج" /></span>
                        <span className="dcell" data-label="المورد">
                          <select value={row.supplierId} onChange={(e) => updateProduct(day.date, row.id, 'supplierId', e.target.value)} aria-label="المورد">
                            <option value="">اختر مورداً…</option>
                            {state.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </span>
                        <span className="dcell" data-label="سعر الشراء"><input type="number" min="0" step="0.01" value={row.purchasePrice} onChange={(e) => updateProduct(day.date, row.id, 'purchasePrice', e.target.value)} dir="ltr" aria-label="سعر الشراء" /></span>
                        <span className="dcell" data-label="نسبة البيع %"><input type="number" min="0" step="0.01" value={row.markupPercent} onChange={(e) => updateProduct(day.date, row.id, 'markupPercent', e.target.value)} dir="ltr" aria-label="نسبة البيع" /></span>
                        <span className="dcell" data-label="الإجمالي"><span className="row-total amt">{fmtMoney(row.salePrice)} ⃁</span></span>
                        <span className="dcell dcell-action"><button className="x-btn" type="button" onClick={() => removeRow(day.date, 'productRows', row.id)} aria-label="حذف المنتج">✕</button></span>
                      </div>
                    ))}
                  </DailyTable>

                  <div className="daily-two-cols">
                    <MoneyRows title="النقل" rows={day.transportRows} total={totals.transport} onAdd={() => addRow(day.date, 'transportRows')} onChange={(id, key, value) => updateMoney(day.date, 'transportRows', id, key, value)} onRemove={(id) => removeRow(day.date, 'transportRows', id)} />
                    <MoneyRows title="مصاريف أخرى" rows={day.otherRows} total={totals.other} onAdd={() => addRow(day.date, 'otherRows')} onChange={(id, key, value) => updateMoney(day.date, 'otherRows', id, key, value)} onRemove={(id) => removeRow(day.date, 'otherRows', id)} />
                  </div>
                </section>
              );
            })}
          </div>

          <div className="daily-actions" style={{ marginTop: 16 }}>
            <button className="btn" onClick={save} disabled={saving} type="button">{saving ? 'جارٍ الحفظ…' : 'حفظ التكاليف اليومية'}</button>
            {saveMsg && <span>{saveMsg}</span>}
          </div>
        </>
      )}
    </>
  );
}

function fmtFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} بايت`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} ك.ب`;
  return `${(n / (1024 * 1024)).toFixed(1)} م.ب`;
}

function InvoiceAttachmentsModal({
  invoices, attachments, uploading, attachErr, onUpload, onDeleteAttachment, onClose,
}) {
  const total = invoices.reduce((sum, invoice) => sum + num(invoice.total), 0);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card invoice-attachments-modal" role="dialog" aria-modal="true" aria-label="مرفقات الفواتير">
        <div className="modal-head">
          <div>
            <h2>مرفقات الفواتير</h2>
            <p>{invoices.length ? `${fmtNum(invoices.length)} فاتورة مرتبطة بهذا المشروع` : 'لا توجد فواتير مرتبطة بهذا المشروع حتى الآن'}</p>
          </div>
          <button className="icon-close" type="button" onClick={onClose} aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {invoices.length === 0 ? (
          <Empty title="لا فواتير مرتبطة" desc="عند إنشاء فاتورة وربطها بهذا المشروع ستظهر هنا." />
        ) : (
          <>
            <div className="invoice-attachments-total">
              <span>إجمالي الفواتير</span>
              <strong className="amt">{fmtMoney(total)} ⃁</strong>
            </div>
            <div className="invoice-attachments-list">
              {invoices.map((invoice) => {
                const st = INVOICE_STATUS[invoice.status] || { label: invoice.status, cls: 'p-wait' };
                return (
                  <div className="invoice-attachment-row" key={invoice.id}>
                    <div>
                      <b className="amt" dir="ltr">{invoice.number || 'فاتورة'}</b>
                      <span>{fmtDate(invoice.issue_at)} · {fmtMoney(invoice.total)} ⃁</span>
                    </div>
                    <span className={`pill ${st.cls}`}>{st.label}</span>
                    <button
                      className="btn ghost sm"
                      type="button"
                      onClick={() => {
                        onClose();
                        window.location.assign(`/invoices/${invoice.id}`);
                      }}
                    >
                      فتح الفاتورة
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="sec-head" style={{ marginTop: 18 }}>
          <h2>المستندات</h2>
          <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="more">{fmtNum(attachments.length)}</span>
            <label className={`btn sm${uploading ? ' disabled' : ''}`} htmlFor="cost-attachment-file">
              {uploading ? 'جارٍ الرفع…' : '+ إرفاق مستند'}
            </label>
            <input
              id="cost-attachment-file"
              type="file"
              accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
              multiple
              hidden
              disabled={uploading}
              onChange={(e) => { onUpload(e.target.files); e.target.value = ''; }}
            />
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', margin: '-6px 0 12px' }}>
          فواتير موردين، إيصالات، أو أي مستند متعلّق بتكلفة هذا المشروع — الحد الأقصى 50 ميجابايت للملف
        </div>
        {attachErr && <div className="errbar">{attachErr}</div>}
        {attachments.length === 0 ? (
          <Empty title="لا مستندات بعد" desc="اضغط «+ إرفاق مستند» لإضافة أول مستند." />
        ) : (
          <div className="invoice-attachments-list">
            {attachments.map((file) => (
              <div className="invoice-attachment-row" key={file.id}>
                <div>
                  <a className="amt" href={file.file_url} target="_blank" rel="noreferrer">{file.file_name}</a>
                  <span>{fmtDate(file.created_at)} · {fmtFileSize(file.file_size)}</span>
                </div>
                <button className="btn ghost sm" style={{ color: 'var(--neg)' }} type="button" onClick={() => onDeleteAttachment(file)}>حذف</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DailyTable({ title, total, columns, onAdd, addLabel, children, headClass = '' }) {
  return (
    <div className="daily-table-wrap">
      <div className="daily-subhead">
        <b>{title}</b>
        <span className="amt">{fmtMoney(total)} ⃁</span>
      </div>
      <div className="daily-table">
        <div className={`daily-table-head${headClass ? ` ${headClass}` : ''}`}>
          {columns.map((c) => <span key={c}>{c}</span>)}
        </div>
        {children}
      </div>
      <button className="add-row-btn" type="button" onClick={onAdd}>{addLabel}</button>
    </div>
  );
}

function MoneyRows({ title, rows, total, onAdd, onChange, onRemove }) {
  return (
    <div className="daily-money-box">
      <div className="daily-subhead">
        <b>{title}</b>
        <span className="amt">{fmtMoney(total)} ⃁</span>
      </div>
      {rows.map((row) => (
        <div className="money-row" key={row.id}>
          <input value={row.note} onChange={(e) => onChange(row.id, 'note', e.target.value)} placeholder="وصف" />
          <input type="number" min="0" step="0.01" value={row.amount} onChange={(e) => onChange(row.id, 'amount', e.target.value)} dir="ltr" placeholder="المبلغ" />
          <button className="x-btn" type="button" onClick={() => onRemove(row.id)} aria-label="حذف السطر">✕</button>
        </div>
      ))}
      <button className="add-row-btn" type="button" onClick={onAdd}>+ إضافة</button>
    </div>
  );
}
