'use client';
// مسيّر الرواتب الشهري: توليد من العقود والإجازات والسلف، مراجعة واستقطاعات يدوية،
// ثم اعتماد وإقفال وتصدير ملف التحويل للبنك. الحسابات كلها في قاعدة البيانات
// (payroll_generate / payroll_line_guard / payroll_lock) — الصفحة تعرض وتطلب فقط.
import { useEffect, useMemo, useState } from 'react';
import {
  getPayrollRuns, getPayrollLines, generatePayroll, lockPayroll, updatePayrollLine,
  markPayrollExported, getHrSettings, createHrSetting, getSalariedUtilization,
} from '@/lib/data';
import { toCSV, downloadBlob } from '@/lib/dataio';
import { fmtMoney, fmtNum } from '@/lib/format';
import { Loading, Empty, ErrorBar, Modal, DataTable, Input, TextArea, Money, StatusPill, KpiCard } from '@/components';
import { toast } from '@/app/toast';

const RUN_STATUS = {
  draft: { label: 'مسودة', cls: 'p-wait' },
  approved: { label: 'معتمد', cls: 'p-prog' },
  locked: { label: 'مقفل', cls: 'p-done' },
};
const SETTING_LABELS = {
  gosi_employer_saudi_percent: 'تأمينات — حصة المنشأة (سعودي) %',
  gosi_employee_saudi_percent: 'تأمينات — حصة الموظف (سعودي) %',
  gosi_employer_expat_percent: 'تأمينات — أخطار مهنية (غير سعودي) %',
  gosi_employee_expat_percent: 'تأمينات — حصة الموظف (غير سعودي) %',
  gosi_salary_cap: 'سقف الأجر الخاضع للتأمينات',
  expat_levy_monthly: 'المقابل المالي الشهري للوافد',
  max_deduction_percent: 'سقف الاستقطاعات من الأجر %',
  personal_debt_deduction_percent: 'سقف حسم الدين الشخصي %',
  days_per_month: 'أيام الشهر (لحساب الأجر اليومي)',
  work_hours_per_month: 'ساعات العمل الشهرية',
  annual_leave_days: 'رصيد الإجازة السنوية (يوم)',
};
const n = (v) => Number(v || 0);
const thisMonth = () => new Date().toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);
const monthLabel = (ym) => `${ym.slice(5, 7)}/${ym.slice(0, 4)}`;

export default function PayrollPage() {
  const [tab, setTab] = useState('run');
  return (
    <>
      <style>{CSS}</style>
      <div className="sec-head pr-head">
        <div><h2>مسيّر الرواتب</h2><p>توليد رواتب الشهر من العقود والإجازات والسلف، ثم الاعتماد وملف التحويل للبنك</p></div>
        <div className="pr-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'run'} className={tab === 'run' ? 'on' : ''} onClick={() => setTab('run')}>مسيّر الشهر</button>
          <button role="tab" aria-selected={tab === 'settings'} className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>نسب ولوائح</button>
        </div>
      </div>
      {tab === 'run' ? <RunTab /> : <SettingsTab />}
    </>
  );
}

function RunTab() {
  const [month, setMonth] = useState(thisMonth());
  const [runs, setRuns] = useState(null);
  const [lines, setLines] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [util, setUtil] = useState([]);

  useEffect(() => {
    let alive = true;
    getSalariedUtilization(`${month}-01`).then((rows) => { if (alive) setUtil(rows); }).catch(() => { if (alive) setUtil([]); });
    return () => { alive = false; };
  }, [month]);

  const run = useMemo(() => (runs || []).find((r) => r.period_month?.slice(0, 7) === month) || null, [runs, month]);

  async function load(keepMonth = month) {
    try {
      const all = await getPayrollRuns();
      setRuns(all);
      const current = all.find((r) => r.period_month?.slice(0, 7) === keepMonth);
      setLines(current ? await getPayrollLines(current.id) : []);
      setErr('');
    } catch (e) { setErr(e.message || 'تعذّر تحميل المسيّر'); }
  }
  useEffect(() => { load(month); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  const missingBank = lines.filter((l) => !l.employees?.iban?.trim() || !l.employees?.national_id?.trim());
  const locked = run?.status === 'locked';

  async function generate() {
    if (run && !confirm(`إعادة توليد مسيّر ${monthLabel(month)} ستستبدل كل البنود والاستقطاعات اليدوية. متابعة؟`)) return;
    setBusy(true);
    try { await generatePayroll(`${month}-01`); await load(); toast(run ? 'تمت إعادة التوليد' : 'تم توليد المسيّر'); }
    catch (e) { toast(e.message || 'تعذّر التوليد', 'err'); }
    finally { setBusy(false); }
  }
  async function lock() {
    if (!confirm(`اعتماد وإقفال مسيّر ${monthLabel(month)}؟\n\nبعد الإقفال لا يمكن تعديل البنود، وتُخصم أقساط السلف من أرصدتها.`)) return;
    setBusy(true);
    try { await lockPayroll(run.id); await load(); toast('تم اعتماد المسيّر وإقفاله'); }
    catch (e) { toast(e.message || 'تعذّر الإقفال', 'err'); }
    finally { setBusy(false); }
  }
  async function exportBankFile() {
    const rows = lines.filter((l) => n(l.net_pay) > 0).map((l) => ({
      name: l.employees?.name || '', national_id: l.employees?.national_id || '', iban: l.employees?.iban || '',
      net: n(l.net_pay).toFixed(2), month,
    }));
    const columns = [
      { k: 'name', label: 'اسم الموظف' }, { k: 'national_id', label: 'رقم الهوية/الإقامة' },
      { k: 'iban', label: 'الآيبان' }, { k: 'net', label: 'صافي الراتب' }, { k: 'month', label: 'الشهر' },
    ];
    downloadBlob(toCSV(rows, columns), `tarteeb-payroll-${month}.csv`, 'text/csv;charset=utf-8');
    try { await markPayrollExported(run.id); await load(); } catch { /* التصدير تم؛ تسجيل الوقت ثانوي */ }
    toast(`تم تصدير ${fmtNum(rows.length)} تحويل`);
  }

  if (err) return <ErrorBar message={err} />;
  if (!runs) return <Loading />;

  return (
    <>
      <div className="card pr-bar">
        <Input label="الشهر" type="month" ltr value={month} onChange={(e) => setMonth(e.target.value || thisMonth())} />
        <div className="pr-status">{run ? <StatusPill status={run.status} map={RUN_STATUS} /> : <span className="muted">لم يُولَّد بعد</span>}{run?.exported_at && <small>صُدِّر ملف البنك</small>}</div>
        <div className="pr-actions">
          {!locked && <button className="btn ghost" disabled={busy} onClick={generate}>{run ? 'إعادة التوليد' : 'توليد المسيّر'}</button>}
          {run && !locked && lines.length > 0 && <button className="btn" disabled={busy || missingBank.length > 0} onClick={lock} title={missingBank.length ? 'أكمل الآيبان ورقم الهوية أولاً' : ''}>اعتماد وإقفال</button>}
          {locked && <button className="btn" onClick={exportBankFile}>ملف التحويل للبنك</button>}
        </div>
      </div>

      {missingBank.length > 0 && !locked && (
        <div className="pr-alert">لا يمكن الإقفال: {missingBank.map((l) => l.employees?.name).join('، ')} بلا آيبان أو رقم هوية. أكملها من ملف الموظف (نظام حماية الأجور يرفض التحويل بدونها).</div>
      )}

      {run && (
        <div className="kpis pr-kpis">
          <KpiCard label="إجمالي الأجور" value={`${fmtMoney(run.total_gross)} ⃁`} trend={`${fmtNum(lines.length)} موظف`} definition="مجموع الأجر الأساسي والبدلات الثابتة قبل أي حسم." period={monthLabel(month)} formula="جمع (الأساسي + البدلات) لكل بند" />
          <KpiCard label="الاستقطاعات" value={`${fmtMoney(run.total_deductions)} ⃁`} definition="حسم الغياب والإجازات غير المدفوعة، أقساط السلف، الاستقطاعات اليدوية، وحصة الموظف في التأمينات." period={monthLabel(month)} formula="غياب + سلف + أخرى + تأمينات الموظف" />
          <KpiCard tone="pos" label="صافي التحويل" value={`${fmtMoney(run.total_net)} ⃁`} definition="المبلغ الذي يُحوَّل لحسابات الموظفين." period={monthLabel(month)} formula="الإجمالي − الاستقطاعات" />
          <KpiCard tone="alert" label="تكلفة المنشأة" value={`${fmtMoney(run.total_employer_cost)} ⃁`} definition="ما تتحمله ترتيب فعلياً عن الموظفين هذا الشهر: الأجر المستحق + تأمينات المنشأة + التأمين الطبي + الرسوم الحكومية + مخصص نهاية الخدمة والتذاكر." period={monthLabel(month)} formula="الأجر المستحق + كل تكاليف المنشأة الشهرية" />
        </div>
      )}

      {util.length > 0 && (() => {
        const paid = util.reduce((t, u) => t + n(u.paid_hours), 0);
        const used = util.reduce((t, u) => t + n(u.project_hours), 0);
        const pct = paid ? Math.round((used / paid) * 1000) / 10 : 0;
        return (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="sec-head"><h2>نسبة تشغيل الأساسيين</h2><span className="more">{fmtNum(pct)}% من الساعات المدفوعة اشتغلت على مشاريع</span></div>
            <DataTable rows={util} columns={[
              { key: 'name', label: 'الموظف', primary: true, render: (u) => <span className="nm">{u.name}</span> },
              { key: 'paid_hours', label: 'ساعات مدفوعة', render: (u) => fmtNum(u.paid_hours) },
              { key: 'project_hours', label: 'ساعات مشاريع', render: (u) => fmtNum(u.project_hours) },
              { key: 'utilization_pct', label: 'النسبة', render: (u) => <b>{fmtNum(u.utilization_pct)}%</b> },
            ]} />
            <p className="muted" style={{ padding: '0 16px 12px', margin: 0 }}>الباقي وقت مكتبي أو غير محمّل على مشروع؛ سجّل ساعات الأساسيين من صفحة التكاليف حتى تكتمل النسبة.</p>
          </div>
        );
      })()}

      <div className="card" style={{ padding: '6px 0' }}>
        <DataTable rows={lines} empty={
          run ? <Empty title="لا بنود" desc="لا يوجد موظف نشط بعقد. أضف العقد من ملف الموظف ثم أعد التوليد." />
            : <Empty title={`لا مسيّر لشهر ${monthLabel(month)}`} desc="اضغط «توليد المسيّر» ليُحتسب من العقود والإجازات والسلف. يحتاج كل موظف عقداً في ملفه المالي." />
        } columns={[
          { key: 'employee', label: 'الموظف', primary: true, render: (l) => <><span className="nm">{l.employees?.name || '—'}</span>{(!l.employees?.iban?.trim() || !l.employees?.national_id?.trim()) && <small className="warn">بلا آيبان/هوية</small>}</> },
          { key: 'gross_pay', label: 'الإجمالي', render: (l) => <Money v={l.gross_pay} /> },
          { key: 'absence', label: 'غياب', render: (l) => n(l.absence_deduction) ? <div className="cell2"><Money v={-n(l.absence_deduction)} /><small>{fmtNum(l.absence_days)} يوم</small></div> : '—' },
          { key: 'advance_installment', label: 'سلفة', render: (l) => n(l.advance_installment) ? <Money v={-n(l.advance_installment)} /> : '—' },
          { key: 'other_deductions', label: 'أخرى', render: (l) => <div className="cell2">{n(l.other_deductions) ? <Money v={-n(l.other_deductions)} /> : '—'}{l.note && <small>{l.note}</small>}</div> },
          { key: 'gosi_employee', label: 'تأمينات', render: (l) => n(l.gosi_employee) ? <Money v={-n(l.gosi_employee)} /> : '—' },
          { key: 'net_pay', label: 'الصافي', render: (l) => <b><Money v={l.net_pay} /></b> },
          { key: 'total_employer_cost', label: 'تكلفة المنشأة', render: (l) => <Money v={l.total_employer_cost} /> },
          { key: 'actions', label: '', align: 'left', render: (l) => !locked && <button className="btn ghost sm" onClick={() => setEditing(l)}>استقطاع</button> },
        ]} />
      </div>

      <RunsHistory runs={runs} onPick={(ym) => setMonth(ym)} />

      {editing && <DeductionModal line={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
    </>
  );
}

function DeductionModal({ line, onClose, onSaved }) {
  const [amount, setAmount] = useState(String(n(line.other_deductions) || ''));
  const [note, setNote] = useState(line.note || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  async function save(e) {
    e.preventDefault();
    if (n(amount) < 0) { setErr('المبلغ لا يكون سالباً'); return; }
    setSaving(true); setErr('');
    try { await updatePayrollLine(line.id, { other_deductions: n(amount), note: note.trim() || null }); toast('تم تحديث البند'); await onSaved(); }
    catch (e2) { setErr(e2.message || 'تعذّر الحفظ'); }
    finally { setSaving(false); }
  }
  return (
    <Modal open onClose={onClose} title="استقطاع إضافي" subtitle={line.employees?.name} as="form" onSubmit={save} size="sm"
      footer={<><button type="button" className="btn ghost" onClick={onClose}>إلغاء</button><button className="btn" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ'}</button></>}>
      {err && <div className="errbar">{err}</div>}
      <Input label="المبلغ" type="number" min="0" step="0.01" ltr value={amount} onChange={(e) => setAmount(e.target.value)} />
      <TextArea label="السبب (يظهر للمراجعة)" value={note} onChange={(e) => setNote(e.target.value)} rows="2" />
      <small className="muted">النظام يرفض الحفظ إن تجاوزت السلف والاستقطاعات سقف النسبة النظامية من الأجر المستحق.</small>
    </Modal>
  );
}

function RunsHistory({ runs, onPick }) {
  if (!runs.length) return null;
  return (
    <div className="card pr-history">
      <h3>المسيّرات السابقة</h3>
      <DataTable rows={runs} columns={[
        { key: 'period_month', label: 'الشهر', primary: true, render: (r) => <button className="link-btn" onClick={() => onPick(r.period_month.slice(0, 7))}>{monthLabel(r.period_month.slice(0, 7))}</button> },
        { key: 'status', label: 'الحالة', render: (r) => <StatusPill status={r.status} map={RUN_STATUS} /> },
        { key: 'total_net', label: 'الصافي', render: (r) => <Money v={r.total_net} /> },
        { key: 'total_employer_cost', label: 'تكلفة المنشأة', render: (r) => <Money v={r.total_employer_cost} /> },
        { key: 'exported_at', label: 'ملف البنك', render: (r) => (r.exported_at ? 'صُدِّر' : '—') },
      ]} />
    </div>
  );
}

function SettingsTab() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try { setRows(await getHrSettings()); } catch (e) { setErr(e.message || 'تعذّر تحميل الإعدادات'); }
  }
  useEffect(() => { load(); }, []);

  // القيمة السارية اليوم: أحدث سطر تاريخ سريانه ≤ اليوم
  const current = useMemo(() => {
    const now = today(); const map = new Map();
    for (const r of rows || []) {
      if (r.effective_from > now) continue;
      const prev = map.get(r.key);
      if (!prev || r.effective_from > prev.effective_from) map.set(r.key, r);
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [rows]);
  const upcoming = (rows || []).filter((r) => r.effective_from > today());

  async function save(e) {
    e.preventDefault();
    if (form.value === '' || Number.isNaN(Number(form.value))) return;
    setSaving(true);
    try {
      await createHrSetting({ key: form.key, value: Number(form.value), effective_from: form.effective_from, note: form.note.trim() || null });
      toast('تمت إضافة القيمة الجديدة'); setForm(null); await load();
    } catch (e2) { toast(e2.message || 'تعذّر الحفظ', 'err'); }
    finally { setSaving(false); }
  }

  if (err) return <ErrorBar message={err} />;
  if (!rows) return <Loading />;
  return (
    <>
      <p className="muted pr-note">تغيير أي نسبة يُضاف كقيمة جديدة بتاريخ سريان، والقيم القديمة تبقى، فالمسيّرات المقفلة تظل مفهومة بنسب وقتها.</p>
      <div className="card" style={{ padding: '6px 0' }}>
        <DataTable rows={current} empty={<Empty title="لا إعدادات" desc="—" />} columns={[
          { key: 'key', label: 'البند', primary: true, render: (r) => <><span className="nm">{SETTING_LABELS[r.key] || r.key}</span>{r.note && <><br /><small>{r.note}</small></>}</> },
          { key: 'value', label: 'القيمة السارية', render: (r) => <b>{fmtNum(r.value)}</b> },
          { key: 'effective_from', label: 'ساري منذ', render: (r) => r.effective_from },
          { key: 'actions', label: '', align: 'left', render: (r) => <button className="btn ghost sm" onClick={() => setForm({ key: r.key, value: String(r.value), effective_from: today(), note: '' })}>قيمة جديدة</button> },
        ]} />
      </div>
      {upcoming.length > 0 && <div className="pr-alert info">قيم مجدولة: {upcoming.map((r) => `${SETTING_LABELS[r.key] || r.key} = ${fmtNum(r.value)} من ${r.effective_from}`).join('، ')}</div>}
      {form && (
        <Modal open onClose={() => setForm(null)} title="قيمة جديدة" subtitle={SETTING_LABELS[form.key] || form.key} as="form" onSubmit={save} size="sm"
          footer={<><button type="button" className="btn ghost" onClick={() => setForm(null)}>إلغاء</button><button className="btn" disabled={saving}>حفظ</button></>}>
          <Input label="القيمة" type="number" step="0.0001" ltr value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} required />
          <Input label="تاريخ السريان" type="date" ltr value={form.effective_from} onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))} required />
          <TextArea label="ملاحظة / المرجع النظامي" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} rows="2" />
        </Modal>
      )}
    </>
  );
}

const CSS = `
.pr-head{margin-bottom:16px;align-items:flex-end;gap:12px;flex-wrap:wrap}.pr-head h2{margin:0}.pr-head p{margin:5px 0 0;color:var(--muted);font-size:13px}
.pr-tabs{display:flex;gap:4px;background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:3px}.pr-tabs button{border:0;background:none;padding:7px 14px;border-radius:8px;font:inherit;font-size:13px;cursor:pointer;color:var(--muted)}.pr-tabs button.on{background:var(--surface);color:var(--text, inherit);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.06)}
.pr-bar{display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap;padding:14px;margin-bottom:14px}.pr-bar .field{margin:0;min-width:170px}.pr-status{display:flex;flex-direction:column;gap:4px;padding-bottom:6px}.pr-status small{color:var(--muted);font-size:11.5px}.pr-actions{display:flex;gap:8px;margin-inline-start:auto;flex-wrap:wrap}
.pr-kpis{grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:14px}
.pr-alert{margin-bottom:14px;padding:11px 15px;border-radius:11px;background:var(--neg-bg);color:var(--neg);font-size:13px;line-height:1.7}.pr-alert.info{background:var(--gold-bg);color:#725821;margin-top:14px}
.cell2{display:grid;gap:3px}.cell2 small{color:var(--muted);font-size:11px}.warn{display:block;color:var(--neg);font-size:11px;margin-top:3px}
.pr-history{margin-top:16px;padding:14px 0 6px}.pr-history h3{margin:0 16px 8px;font-size:14px}.link-btn{border:0;background:none;color:var(--green);padding:0;cursor:pointer;font:inherit}
.muted{color:var(--muted)}.pr-note{font-size:12.5px;margin:0 0 12px}
@media(max-width:900px){.pr-kpis{grid-template-columns:repeat(2,1fr)}}
@media(max-width:580px){.pr-kpis{grid-template-columns:1fr}.pr-actions{margin-inline-start:0;width:100%}.pr-actions .btn{flex:1;justify-content:center}}
`;
