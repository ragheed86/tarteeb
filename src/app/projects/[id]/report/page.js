'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  getProject, getClient, getProjectCosts, getProjectFinancials,
} from '@/lib/data';
import { fmtMoney, fmtNum, fmtDate, CURRENCY, SOURCE_LABEL } from '@/lib/format';
import { isSupervisorLaborRow } from '@/lib/labor';
import { Loading, Empty, ErrorBar } from '../../../ui';

const COST_KIND = { labor: 'عمالة', materials: 'مواد', transport: 'نقل', bonus: 'حوافز', other: 'أخرى' };

function n(value) {
  return Number(value) || 0;
}

function pct(part, total) {
  return total > 0 ? Math.max(4, Math.min(100, Math.round((part / total) * 100))) : 0;
}

function daySortValue(day) {
  if (day.key.includes('الأول')) return 1;
  if (day.key.includes('الثاني')) return 2;
  if (day.key.includes('الثالث')) return 3;
  if (day.key.includes('الرابع')) return 4;
  return 99;
}

function dayFromCost(cost) {
  if (cost.work_date) {
    const date = String(cost.work_date).slice(0, 10);
    return { key: date || 'بنود يومية', title: fmtDate(date), rawDate: date };
  }
  const label = String(cost.label || '');
  if (label.startsWith('يومي:')) {
    const date = label.split(' · ')[0].replace('يومي:', '').trim();
    return { key: date || 'بنود يومية', title: fmtDate(date), rawDate: date };
  }
  const dayMatch = label.match(/اليوم\s+(الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)(?:\s+(.+))?$/);
  if (dayMatch) {
    const dayName = `اليوم ${dayMatch[1]}`;
    return { key: dayName, title: `${dayName}${dayMatch[2] ? ` - ${dayMatch[2]}` : ''}`, rawDate: '' };
  }
  return { key: 'بنود عامة', title: 'بنود عامة', rawDate: '' };
}

function cleanLabel(cost) {
  if (cost.kind === 'materials' && cost.product_name) return cost.product_name;
  if (cost.kind === 'labor' && cost.worker_name) return `عمالة: ${cost.worker_name}`;
  if ((cost.kind === 'transport' || cost.kind === 'other') && cost.note) return cost.note;
  if (cost.note) return cost.note;
  let label = String(cost.label || COST_KIND[cost.kind] || 'بند تكلفة');
  label = label.replace(/^يومي:\s*[^·]+ ·\s*/, '');
  label = label.replace(/\s*-\s*اليوم\s+(الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر).*$/, '');
  return label || 'بند تكلفة';
}

function groupCosts(costs) {
  const days = new Map();
  for (const cost of costs || []) {
    const meta = dayFromCost(cost);
    if (!days.has(meta.key)) days.set(meta.key, { ...meta, rows: [], total: 0 });
    const day = days.get(meta.key);
    day.rows.push(cost);
    day.total += n(cost.amount);
  }
  return Array.from(days.values()).sort((a, b) => daySortValue(a) - daySortValue(b) || a.key.localeCompare(b.key));
}

// يبني ملف PDF من عنصر التقرير: تصوير DOM ثم ضغطه داخل صفحة A4 واحدة
async function buildPdfBlob(node) {
  const pageW = 210;
  const pageH = 297;
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  const canvas = await html2canvas(node, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
    windowWidth: 794,
    onclone: (doc) => {
      const report = doc.querySelector('[data-pdf-report="project-expense"]');
      if (!report) return;
      report.style.width = `${pageW}mm`;
      report.style.maxWidth = `${pageW}mm`;
      report.style.minHeight = `${pageH}mm`;
      report.style.margin = '0';
      report.style.border = '0';
      report.style.borderRadius = '0';
      report.style.boxShadow = 'none';
      report.style.overflow = 'visible';
    },
  });
  const imgW = pageW;
  const imgH = (canvas.height * imgW) / canvas.width;
  const fit = Math.min(1, pageH / imgH);
  const fittedW = imgW * fit;
  const fittedH = imgH * fit;
  const x = (pageW - fittedW) / 2;
  const img = canvas.toDataURL('image/jpeg', 0.92);
  const pdf = new jsPDF({ unit: 'mm', format: [pageW, pageH], orientation: 'portrait' });
  pdf.addImage(img, 'JPEG', x, 0, fittedW, fittedH);
  return pdf.output('blob');
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export default function ProjectExpenseReport() {
  const { id } = useParams();
  const router = useRouter();
  const [state, setState] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const reportRef = useRef(null);
  const pdfCache = useRef(null);

  useEffect(() => {
    async function load() {
      setErr('');
      try {
        const project = await getProject(id);
        const [client, costs, fin] = await Promise.all([
          project.client_id ? getClient(project.client_id) : Promise.resolve(null),
          getProjectCosts(id),
          getProjectFinancials(id).catch(() => null),
        ]);
        setState({ project, client, costs, fin });
      } catch (e) {
        setErr(e.message || 'تعذّر تحميل التقرير');
      }
    }
    load();
  }, [id]);

  const report = useMemo(() => {
    if (!state) return null;
    const { project, costs, fin } = state;
    const sale = n(project.sale_price);
    const totalCost = fin ? n(fin.total_cost) : costs.reduce((sum, c) => sum + n(c.amount), 0);
    const profit = fin ? n(fin.net_profit) : sale - totalCost;
    const margin = sale > 0 ? Math.round((profit / sale) * 1000) / 10 : 0;
    const dayGroups = groupCosts(costs);
    const laborRows = costs.filter((c) => c.kind === 'labor');
    const materialRows = costs.filter((c) => c.kind === 'materials');
    const materialTotal = materialRows.reduce((sum, c) => sum + n(c.amount), 0);
    const transportTotal = costs.filter((c) => c.kind === 'transport').reduce((sum, c) => sum + n(c.amount), 0);
    const supervisorRows = laborRows.filter((c) => isSupervisorLaborRow(c));
    const workerRows = laborRows.filter((c) => !isSupervisorLaborRow(c));
    const laborHourlyTotal = laborRows
      .filter((c) => !isSupervisorLaborRow(c) && n(c.qty) && n(c.hours) && n(c.rate))
      .reduce((sum, c) => sum + n(c.amount), 0);
    const supervisorTotal = supervisorRows.reduce((sum, c) => sum + n(c.amount), 0);
    const otherTotal = Math.max(0, totalCost - laborHourlyTotal - supervisorTotal - transportTotal - materialTotal);
    const workerHours = workerRows.reduce((sum, c) => sum + n(c.qty) * n(c.hours), 0);
    const supervisorHours = supervisorRows.reduce((sum, c) => sum + n(c.qty) * n(c.hours), 0);
    return {
      sale, totalCost, profit, margin, dayGroups, materialRows, materialTotal,
      transportTotal, laborHourlyTotal, supervisorTotal, otherTotal, workerHours, supervisorHours,
    };
  }, [state]);

  async function shareWhatsAppPdf() {
    if (busy) return;
    setBusy(true);
    setNote('');
    try {
      if (!pdfCache.current) pdfCache.current = await buildPdfBlob(reportRef.current);
      const title = state?.project?.title || 'مشروع';
      const fileName = `tarteeb-report-${String(id).slice(0, 8)}.pdf`;
      const file = new File([pdfCache.current], fileName, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: `تقرير مصاريف — ${title}` });
        } catch (e) {
          if (e.name === 'AbortError') return; // المستخدم أغلق قائمة المشاركة
          if (e.name === 'NotAllowedError') {
            setNote('الملف جاهز — اضغط زر المشاركة مرة أخرى لفتح واتساب.');
            return;
          }
          throw e;
        }
      } else {
        downloadBlob(pdfCache.current, fileName);
        setNote('المشاركة المباشرة غير مدعومة على هذا المتصفح — تم تنزيل الملف، أرفقه في واتساب.');
      }
    } catch (e) {
      setNote(`تعذّر إنشاء ملف PDF: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  if (err) return <ErrorBar message={err} />;
  if (!state || !report) return <Loading />;

  const { project, client } = state;
  const workDays = report.dayGroups.filter((d) => d.key !== 'بنود عامة').length || report.dayGroups.length;
  const source = SOURCE_LABEL[client?.source] || client?.source || 'غير محدد';

  return (
    <>
      <div className="report-actions no-print">
        <button className="btn ghost" type="button" onClick={() => router.push(`/projects/${id}`)}>رجوع</button>
        <button className="btn ghost" type="button" onClick={() => window.print()}>طباعة</button>
        <button className="btn wa" type="button" onClick={shareWhatsAppPdf} disabled={busy}>
          {busy ? 'جارٍ التجهيز…' : 'مشاركة واتساب'}
        </button>
      </div>
      {note && <div className="rpt-note no-print">{note}</div>}

      <article className="rpt" ref={reportRef} data-pdf-report="project-expense">
        <header className="rpt-hero">
          <div className="rpt-brand">
            <b>ترتيب</b>
            <span>تقرير مصاريف مشروع</span>
          </div>
          <h1>{project.title || 'مشروع بدون عنوان'}</h1>
          {project.service_type ? <p className="rpt-sub">{project.service_type}</p> : null}
          <div className="rpt-chips">
            <span>{client?.name || 'عميل غير محدد'}</span>
            {client?.district ? <span>{client.district}</span> : null}
            <span>{source}</span>
            <span>{fmtDate(project.start_date)} → {fmtDate(project.due_date)}</span>
            <span>{fmtNum(workDays)} أيام عمل</span>
          </div>
        </header>

        <div className="rpt-body">
          <section className="rpt-kpis">
            <Kpi label="قيمة المشروع" value={report.sale} />
            <Kpi label="إجمالي المصاريف" value={report.totalCost} tone="gold" />
            <Kpi label="صافي الربح" value={report.profit} tone="green" />
            <div className="rpt-kpi green">
              <span>هامش الربح</span>
              <strong>{fmtNum(report.margin)}%</strong>
              <div className="rpt-track"><i style={{ width: `${pct(report.profit, report.sale)}%` }} /></div>
            </div>
          </section>

          <section className="rpt-sec">
            <h2>بيانات المشروع والعميل</h2>
            <div className="rpt-info">
              <Info label="اسم العميل" value={client?.name || '—'} />
              <Info label="الحي" value={client?.district || '—'} />
              <Info label="نوع الخدمة" value={project.service_type || '—'} />
              <Info label="طريقة الوصول إلينا" value={source} />
              <Info label="تاريخ البداية" value={fmtDate(project.start_date)} />
              <Info label="تاريخ النهاية" value={fmtDate(project.due_date)} />
            </div>
          </section>

          <section className="rpt-sec">
            <h2>توزيع التكلفة</h2>
            <div className="rpt-mix">
              <MixLine label="عمالة بالساعة" value={report.laborHourlyTotal} total={report.totalCost} />
              <MixLine label="إشراف" value={report.supervisorTotal} total={report.totalCost} />
              <MixLine label="نقل ومواصلات" value={report.transportTotal} total={report.totalCost} />
              <MixLine label="مواد" value={report.materialTotal} total={report.totalCost} />
              {report.otherTotal > 0 ? <MixLine label="أخرى" value={report.otherTotal} total={report.totalCost} /> : null}
              <div className="rpt-stats">
                <span>{fmtNum(report.workerHours)} ساعة عمل</span>
                <span>{fmtNum(report.supervisorHours)} ساعة إشراف</span>
                <span>{fmtNum(workDays)} أيام عمل</span>
                <span>إجمالي {fmtMoney(report.totalCost)} {CURRENCY}</span>
              </div>
            </div>
          </section>

          <section className="rpt-sec">
            <h2>تفصيل المصاريف حسب اليوم</h2>
            {report.dayGroups.length === 0 ? (
              <Empty title="لا توجد مصاريف" desc="أضف تكاليف المشروع حتى يظهر التقرير." />
            ) : report.dayGroups.map((day) => (
              <div className="rpt-day" key={day.key}>
                <div className="rpt-day-head">
                  <h3>{day.title}</h3>
                  <strong>{fmtMoney(day.total)} {CURRENCY}</strong>
                </div>
                {day.rows.map((row) => <CostRow key={row.id} row={row} />)}
              </div>
            ))}
          </section>

          <section className="rpt-sec">
            <h2>المواد المستخدمة</h2>
            {report.materialRows.length === 0 ? (
              <Empty title="لا توجد مواد" desc="لا توجد مواد مسجلة لهذا المشروع." />
            ) : (
              <div className="rpt-day">
                {report.materialRows.map((row) => <CostRow key={row.id} row={row} />)}
                <div className="rpt-day-head foot">
                  <h3>إجمالي المواد</h3>
                  <strong>{fmtMoney(report.materialTotal)} {CURRENCY}</strong>
                </div>
              </div>
            )}
          </section>

          <footer className="rpt-foot">
            <span>صدر في {fmtDate(new Date().toISOString())}</span>
            <span>نظام ترتيب · tarteeb-six.vercel.app</span>
          </footer>
        </div>
      </article>
    </>
  );
}

function Kpi({ label, value, tone = '' }) {
  return (
    <div className={`rpt-kpi ${tone}`}>
      <span>{label}</span>
      <strong>{fmtMoney(value)} {CURRENCY}</strong>
    </div>
  );
}

function Info({ label, value }) {
  return <div className="rpt-info-item"><span>{label}</span><b>{value}</b></div>;
}

function MixLine({ label, value, total }) {
  return (
    <div className="rpt-mix-line">
      <span>{label}</span>
      <div><i style={{ width: `${pct(value, total)}%` }} /></div>
      <b>{fmtMoney(value)}</b>
    </div>
  );
}

function CostRow({ row }) {
  const qty = n(row.qty);
  const hours = n(row.hours);
  const rate = n(row.rate);
  const hasDetail = qty && hours && rate;
  const supplier = row.kind === 'materials' && row.supplier_name ? ` · المورد: ${row.supplier_name}` : '';
  const sale = row.kind === 'materials' && n(row.sale_price) ? ` · البيع: ${fmtMoney(row.sale_price)} ${CURRENCY}` : '';
  return (
    <div className="rpt-row">
      <div className="rpt-row-main">
        <b>{cleanLabel(row)}</b>
        <small>
          {COST_KIND[row.kind] || row.kind}
          {supplier}
          {sale}
          {hasDetail ? ` · ${fmtNum(qty)} عامل × ${fmtNum(hours)} ساعة × ${fmtMoney(rate)} ${CURRENCY} (${fmtNum(qty * hours)} ساعة)` : ''}
        </small>
      </div>
      <strong className="rpt-amt">{fmtMoney(row.amount)} {CURRENCY}</strong>
    </div>
  );
}
