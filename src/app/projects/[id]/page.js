'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getProject, getClient, getEmployeesBasic, getProjectFinancials,
  getProjectTasks, createProjectTask, updateProjectTask, removeProjectTask,
  getProjectTeam, addProjectTeam, removeProjectTeam,
  getProjectMedia, uploadProjectMedia, removeProjectMedia, updateProject,
  getProjectCosts, createProjectCost, removeProjectCost, removeProject,
  getSuppliers, getEmployeeHourlyRates, getProjectInvoices, saveProjectCosts,
  estimateToCostRows, costRowsToEstimate,
  getProjectCostAttachments, uploadProjectCostAttachment, removeProjectCostAttachment,
} from '@/lib/data';
import {
  fmtMoney, fmtNum, fmtDate, INVOICE_STATUS, PROJECT_STATUS, displayProgress, progressForStatus,
} from '@/lib/format';
import { isSupervisorLaborRow } from '@/lib/labor';
import { Loading, Empty, ErrorBar, DataTable, KpiCard } from '@/components';
import { canAccess } from '@/lib/permissions';
import { useAccess } from '@/lib/useAccess';
import {
  num, isoLocal, addDaysISO, buildDailyRows, calcDay,
  updateRow, updateLaborRow, emptyLabor, emptyProduct, emptyMoney,
} from '@/lib/dailyCost';

const COST_KIND = { labor: 'عمالة', materials: 'مواد', transport: 'نقل', bonus: 'حوافز', other: 'أخرى' };
const MEDIA_KIND = { before: 'قبل', after: 'بعد', other: 'أخرى' };
const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|ogg)$/i;
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024; // حد Supabase الافتراضي 50 ميجابايت

function costDescription(cost) {
  if (cost.product_name) return cost.supplier_name ? `${cost.product_name} · ${cost.supplier_name}` : cost.product_name;
  if (cost.worker_name) return `${isSupervisorLaborRow(cost) ? 'إشراف' : 'عمالة'}: ${cost.worker_name}`;
  if (cost.note) return cost.note;
  return cost.label || '—';
}

function isVideoMedia(media) {
  return VIDEO_EXT_RE.test(media.file_url || '') || VIDEO_EXT_RE.test(media.file_path || '');
}

function fmtFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} بايت`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} ك.ب`;
  return `${(n / (1024 * 1024)).toFixed(1)} م.ب`;
}

export default function ProjectDetail() {
  const { id } = useParams();
  const router = useRouter();
  const { access } = useAccess();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [deleting, setDeleting] = useState(false);

  // ---- قسم تكلفة المشروع (مدمج من /cost) ----
  const [costCtx, setCostCtx] = useState({ suppliers: [], rates: {} });
  const [salePrice, setSalePrice] = useState('');
  const [dailyRows, setDailyRows] = useState([]);
  const [projectInvoices, setProjectInvoices] = useState([]);
  const [invoicePanelOpen, setInvoicePanelOpen] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachErr, setAttachErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  async function loadAll() {
    setErr('');
    try {
      const project = await getProject(id);
      const [client, employees, fin, tasks, team, media, costs, suppliers, hourlyRates, invoices, files] = await Promise.all([
        project.client_id ? getClient(project.client_id) : Promise.resolve(null),
        getEmployeesBasic(),
        getProjectFinancials(id).catch(() => null),
        getProjectTasks(id), getProjectTeam(id), getProjectMedia(id), getProjectCosts(id),
        getSuppliers().catch(() => []),
        getEmployeeHourlyRates().catch(() => []),
        getProjectInvoices(id).catch(() => []),
        getProjectCostAttachments(id).catch(() => []),
      ]);
      setD({ project, client, employees, fin, tasks, team, media, costs });

      const rates = Object.fromEntries((hourlyRates || []).map((r) => [r.employee_id, Number(r.hourly_cost) || 0]));
      setCostCtx({ suppliers: suppliers || [], rates });
      setSalePrice(project.sale_price ?? '');
      setProjectInvoices(invoices || []);
      setAttachments(files || []);
      setAttachErr('');
      setInvoicePanelOpen(false);

      const restored = costRowsToEstimate(costs);
      const rows = buildDailyRows(project, restored.dailyRows).map((day) => ({
        ...day,
        productRows: day.productRows.map((row) => {
          const supplier = (suppliers || []).find((s) => s.name === row.supplierName);
          return { ...row, supplierId: row.supplierId || supplier?.id || '' };
        }),
      }));
      setDailyRows(rows);
    } catch (e) { setErr(e.message || 'تعذّر تحميل المشروع'); }
  }
  useEffect(() => { loadAll(); }, [id]);

  async function refreshCosts() {
    const [fin, costs] = await Promise.all([getProjectFinancials(id).catch(() => null), getProjectCosts(id)]);
    setD((s) => ({ ...s, fin, costs }));
  }

  async function deleteCurrentProject() {
    if (deleting || !d?.project) return;
    if (!confirm(`هل أنت متأكد من حذف المشروع «${d.project.title}»؟\n\nسيتم حذف المهام والفريق والتكاليف والصور والمرفقات نهائياً. ستبقى الفواتير الصادرة ومصاريف الشركة المرتبطة به محفوظة كسجلات مالية ولكن بدون ربط بالمشروع.\n\nلا يمكن التراجع عن هذا الإجراء.`)) return;
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

  // ---- دوال تحرير الجدول اليومي (مدمجة من /cost، بلا تغيير منطقي) ----
  function updateDay(date, updater) {
    setDailyRows((days) => days.map((day) => (day.date === date ? updater(day) : day)));
  }
  function updateLabor(date, rowId, key, value) {
    updateDay(date, (day) => ({ ...day, laborRows: updateLaborRow(day.laborRows, rowId, key, value, d?.employees || [], costCtx.rates || {}) }));
  }
  function updateProduct(date, rowId, key, value) {
    updateDay(date, (day) => ({ ...day, productRows: updateRow(day.productRows, rowId, key, value, costCtx.suppliers) }));
  }
  function updateMoney(date, group, rowId, key, value) {
    updateDay(date, (day) => ({ ...day, [group]: updateRow(day[group], rowId, key, value, costCtx.suppliers) }));
  }
  function addDay() {
    setDailyRows((days) => {
      const last = days.at(-1)?.date || d?.project?.due_date || d?.project?.start_date || isoLocal(new Date());
      return [...days, { date: addDaysISO(last, 1), laborRows: [emptyLabor()], productRows: [emptyProduct()], transportRows: [], otherRows: [] }];
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
  function removeRow(date, group, rowId) {
    updateDay(date, (day) => ({ ...day, [group]: day[group].filter((r) => r.id !== rowId) }));
  }
  function removeDay(date) {
    setDailyRows((days) => days.filter((day) => day.date !== date));
  }

  async function onUploadAttachments(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploadingAttachment(true);
    setAttachErr('');
    try {
      for (const file of files) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          setAttachErr(`«${file.name}» يتجاوز الحد الأقصى (50 ميجابايت)`);
          continue;
        }
        const row = await uploadProjectCostAttachment(id, file);
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
    if (!d?.project || status === d.project.status) return;
    const prevStatus = d.project.status;
    const prevProgress = d.project.progress;
    const progress = progressForStatus(status, d.project.progress);
    setD((s) => ({ ...s, project: { ...s.project, status, progress } }));
    try {
      await updateProject(id, { status, progress });
    } catch (e) {
      setD((s) => ({ ...s, project: { ...s.project, status: prevStatus, progress: prevProgress } }));
      setSaveMsg(e.message || 'تعذّر تحديث الحالة');
    }
  }

  async function saveDailyCosts() {
    if (!d?.project) return;
    const price = num(salePrice);
    setSaving(true); setSaveMsg('');
    try {
      const up = await updateProject(id, { sale_price: price });
      await saveProjectCosts(id, estimateToCostRows({ dailyRows }), { scope: 'daily' });
      setD((s) => ({ ...s, project: { ...s.project, sale_price: up.sale_price } }));
      await refreshCosts();
      setSaveMsg('تم حفظ التكاليف اليومية');
    } catch (e) {
      setSaveMsg(e.message || 'تعذّر الحفظ');
    } finally {
      setSaving(false);
    }
  }

  if (err) return <ErrorBar message={err} />;
  if (!d) return <Loading />;

  const { project, client, employees, fin, tasks, team, media, costs } = d;
  const st = PROJECT_STATUS[project.status] || { label: project.status, cls: 'p-wait' };
  const supervisor = employees.find((e) => e.id === project.supervisor_id);
  const teamIds = new Set(team.map((t) => t.employee_id));
  const totalCost = fin ? fin.total_cost : costs.reduce((s, c) => s + Number(c.amount || 0), 0);
  // الفرق بين إجمالي الـ view وبنود التكلفة = مصاريف شركة مربوطة بالمشروع من صفحة المصاريف
  const linkedExpenses = Math.max(0, Number(totalCost || 0) - costs.reduce((s, c) => s + Number(c.amount || 0), 0));
  const netProfit = fin ? fin.net_profit : Number(project.sale_price || 0) - totalCost;
  const marginPct = fin ? fin.margin_pct : (project.sale_price > 0 ? Math.round(netProfit / project.sale_price * 100) : 0);

  // ---- حسابات قسم التكلفة اليومي (مدمجة من /cost، بلا تغيير منطقي) ----
  const dayTotals = dailyRows.map((day) => ({ date: day.date, ...calcDay(day) }));
  const dailyTotal = dayTotals.reduce((s, dt) => s + dt.total, 0);
  const serviceCost = dayTotals.reduce((s, dt) => s + dt.serviceCost, 0);
  const organizersCost = dayTotals.reduce((s, dt) => s + dt.organizersCost, 0);
  const organizersSale = dayTotals.reduce((s, dt) => s + dt.organizersSale, 0);
  const price = num(salePrice);
  const serviceProfit = price - serviceCost;
  const serviceMargin = price > 0 ? Math.round((serviceProfit / price) * 100) : 0;
  const organizersProfit = organizersSale - organizersCost;
  const projectSale = price + organizersSale;
  const projectProfit = serviceProfit + organizersProfit;
  const laborSummary = dailyRows.reduce((summary, day) => {
    let hasLabor = false;
    for (const row of day.laborRows || []) {
      const workers = num(row.workerCount);
      const rowHours = workers * num(row.hours);
      const amount = rowHours * num(row.rate);
      if (workers || rowHours || amount) hasLabor = true;
      if (isSupervisorLaborRow(row)) {
        summary.supervisorDays += workers;
        summary.supervisorHours += rowHours;
        summary.supervisorAmount += amount;
      } else {
        summary.workerDays += workers;
        summary.workerHours += rowHours;
        summary.workerAmount += amount;
      }
      summary.hours += rowHours;
      summary.amount += amount;
      if (row.workerType === 'employee') { summary.salariedAmount += amount; summary.salariedHours += rowHours; }
      else { summary.partTimeAmount += amount; summary.partTimeHours += rowHours; }
    }
    if (hasLabor) summary.days += 1;
    return summary;
  }, { days: 0, workerDays: 0, supervisorDays: 0, workerHours: 0, supervisorHours: 0, workerAmount: 0, supervisorAmount: 0, hours: 0, amount: 0, salariedAmount: 0, salariedHours: 0, partTimeAmount: 0, partTimeHours: 0 });

  const canSeeCost = canAccess(access, 'cost');

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
        <KpiCard label="إجمالي التكاليف" value={`${fmtMoney(totalCost)} ⃁`} definition="مجموع جميع بنود التكلفة المرتبطة بهذا المشروع." period="هذا المشروع" formula="جمع العمالة والمواد والنقل والحوافز والتكاليف الأخرى + مصاريف الشركة المرتبطة بالمشروع" breakdown={[...(linkedExpenses > 0.005 ? [{ label: 'مصاريف مرتبطة من صفحة المصاريف', value: `${fmtMoney(linkedExpenses)} ⃁` }] : []), ...costs.slice(0, 6).map((cost) => ({ label: costDescription(cost), value: `${fmtMoney(cost.amount)} ⃁` }))]} note={costs.length > 6 ? `يظهر أول 6 بنود من أصل ${fmtNum(costs.length)}.` : undefined} />
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

      {canSeeCost && (
        <>
          <div className="daily-cost-summary" style={{ marginTop: 16 }}>
            <div className="card">
              <div className="uid">حالة المشروع</div>
              <select
                className={`status-select pill ${(PROJECT_STATUS[project.status] || { cls: 'p-wait' }).cls}`}
                value={project.status || 'quote'}
                onChange={(e) => changeStatus(e.target.value)}
                aria-label="حالة المشروع"
              >
                {Object.entries(PROJECT_STATUS).map(([value, meta]) => (
                  <option key={value} value={value}>{meta.label}</option>
                ))}
              </select>
            </div>
            <div className="card">
              <div className="field" style={{ marginBottom: 0 }}>
                <label>سعر بيع الخدمة (بدون المنظمات)</label>
                <input type="number" min="0" step="0.01" value={salePrice} dir="ltr" onChange={(e) => setSalePrice(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="cost-breakdown-grid">
            <div className="result cb-box">
              <div className="cb-title">تكلفة المشروع بدون المنظمات</div>
              <div className="mg">ربح الخدمة</div>
              <div className="big">{fmtMoney(serviceProfit)} ⃁</div>
              <div className="mg">تكلفة الخدمة {fmtMoney(serviceCost)} ⃁ · هامش {serviceMargin}%</div>
            </div>
            <div className="result cb-box">
              <div className="cb-title">تكلفة وربح المنظمات</div>
              <div className="mg">ربح المنظمات</div>
              <div className="big">{fmtMoney(organizersProfit)} ⃁</div>
              <div className="mg">تكلفة {fmtMoney(organizersCost)} ⃁ · بيع {fmtMoney(organizersSale)} ⃁</div>
            </div>
            <div className="result cb-box cb-total">
              <div className="cb-title">إجمالي الربح من المشروع</div>
              <div className="mg">ربح المشروع كاملاً</div>
              <div className="big">{fmtMoney(projectProfit)} ⃁</div>
              <div className="mg">بيع {fmtMoney(projectSale)} ⃁ · تكلفة {fmtMoney(dailyTotal)} ⃁</div>
            </div>
          </div>

          {(laborSummary.workerDays > 0 || laborSummary.supervisorDays > 0 || laborSummary.hours > 0 || laborSummary.amount > 0) && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="sec-head"><h2>ملخص العمالة والإشراف</h2><span className="more">{fmtNum(laborSummary.days)} يوم فيه عمالة/إشراف</span></div>
              <div className="daily-people-grid">
                <div className="person-due">
                  <b>إجمالي العمال</b>
                  <span>{fmtNum(laborSummary.workerDays)} عامل/يوم</span>
                  <strong className="amt">{fmtMoney(laborSummary.workerAmount)} ⃁</strong>
                </div>
                <div className="person-due">
                  <b>إجمالي المشرفين</b>
                  <span>{fmtNum(laborSummary.supervisorDays)} مشرف/يوم</span>
                  <strong className="amt">{fmtMoney(laborSummary.supervisorAmount)} ⃁</strong>
                </div>
                <div className="person-due">
                  <b>أساسيون (تحميل داخلي)</b>
                  <span>{fmtNum(laborSummary.salariedHours)} ساعة · تكلفتهم الفعلية بالرواتب</span>
                  <strong className="amt">{fmtMoney(laborSummary.salariedAmount)} ⃁</strong>
                </div>
                <div className="person-due">
                  <b>بالساعة / غير مصنّف</b>
                  <span>{fmtNum(laborSummary.partTimeHours)} ساعة · تكلفة نقدية</span>
                  <strong className="amt">{fmtMoney(laborSummary.partTimeAmount)} ⃁</strong>
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
            <button className="btn ghost" onClick={saveDailyCosts} disabled={saving} type="button">{saving ? 'جارٍ الحفظ…' : 'حفظ التكاليف اليومية'}</button>
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
                    title="العمالة والإشراف"
                    total={totals.labor}
                    columns={['العدد', 'الموظف/المشرف', 'ساعات الفرد', 'إجمالي الساعات', 'سعر الساعة', 'الإجمالي', '']}
                    headClass="labor-head"
                    onAdd={() => addRow(day.date, 'laborRows')}
                    addLabel="+ إضافة عامل/مشرف"
                  >
                    {day.laborRows.map((row) => {
                      const isSupervisor = isSupervisorLaborRow(row);
                      return (
                        <div className="daily-table-row labor-row" key={row.id}>
                          <span className="dcell" data-label={isSupervisor ? 'عدد المشرفين' : 'عدد العمال'}><input type="number" min="0" step="1" value={row.workerCount} onChange={(e) => updateLabor(day.date, row.id, 'workerCount', e.target.value)} dir="ltr" aria-label={isSupervisor ? 'عدد المشرفين' : 'عدد العمال'} /></span>
                          <span className="dcell" data-label="الموظف/المشرف">
                            <select value={row.worker || ''} onChange={(e) => updateLabor(day.date, row.id, 'worker', e.target.value)} aria-label="الموظف أو المشرف">
                              <option value="">— بدون —</option>
                              {(employees || []).map((em) => <option key={em.id} value={em.name}>{em.name}</option>)}
                              {row.worker && row.worker !== 'فريلانسر' && !(employees || []).some((em) => em.name === row.worker) && (
                                <option value={row.worker}>{row.worker}</option>
                              )}
                              <option value="فريلانسر">فريلانسر (مستقل)</option>
                            </select>
                            {row.worker && (
                              <select className="worker-type-select" value={row.workerType || ''} onChange={(e) => updateLabor(day.date, row.id, 'workerType', e.target.value)} aria-label="نوع العامل">
                                <option value="">{isSupervisor ? 'مشرف' : 'غير مصنّف'}</option>
                                <option value="employee">أساسي (براتب)</option>
                                <option value="part_time">بالساعة</option>
                              </select>
                            )}
                          </span>
                          <span className="dcell" data-label={isSupervisor ? 'ساعات المشرف' : 'ساعات العامل'}><input type="number" min="0" step="0.5" value={row.hours} onChange={(e) => updateLabor(day.date, row.id, 'hours', e.target.value)} dir="ltr" aria-label={isSupervisor ? 'ساعات المشرف' : 'ساعات العامل'} /></span>
                          <span className="dcell" data-label="إجمالي الساعات"><span className="row-total amt">{fmtNum(num(row.workerCount) * num(row.hours))}</span></span>
                          <span className="dcell" data-label="سعر الساعة"><input type="number" min="0" step="0.01" value={row.rate} onChange={(e) => updateLabor(day.date, row.id, 'rate', e.target.value)} dir="ltr" aria-label="سعر الساعة" /></span>
                          <span className="dcell" data-label="الإجمالي"><span className="row-total amt">{fmtMoney(num(row.workerCount) * num(row.hours) * num(row.rate))} ⃁</span></span>
                          <span className="dcell dcell-action"><button className="x-btn" type="button" onClick={() => removeRow(day.date, 'laborRows', row.id)} aria-label="حذف البند">✕</button></span>
                        </div>
                      );
                    })}
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
                            {costCtx.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
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
                    <MoneyRows title="النقل" rows={day.transportRows} total={totals.transport} onAdd={() => addRow(day.date, 'transportRows')} onChange={(rowId, key, value) => updateMoney(day.date, 'transportRows', rowId, key, value)} onRemove={(rowId) => removeRow(day.date, 'transportRows', rowId)} />
                    <MoneyRows title="مصاريف أخرى" rows={day.otherRows} total={totals.other} onAdd={() => addRow(day.date, 'otherRows')} onChange={(rowId, key, value) => updateMoney(day.date, 'otherRows', rowId, key, value)} onRemove={(rowId) => removeRow(day.date, 'otherRows', rowId)} />
                  </div>
                </section>
              );
            })}
          </div>

          <div className="daily-actions" style={{ marginTop: 16 }}>
            <button className="btn" onClick={saveDailyCosts} disabled={saving} type="button">{saving ? 'جارٍ الحفظ…' : 'حفظ التكاليف اليومية'}</button>
            {saveMsg && <span>{saveMsg}</span>}
          </div>
        </>
      )}
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

// ---------- مرفقات الفواتير (مدمج من /cost) ----------
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
                    <Link
                      className="btn ghost sm"
                      href={`/invoices/${invoice.id}`}
                      onClick={onClose}
                    >
                      فتح الفاتورة
                    </Link>
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

// ---------- الجدول اليومي (مدمج من /cost) ----------
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
