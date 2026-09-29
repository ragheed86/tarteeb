'use client';
// الملف المالي للموظف: العقد ومكونات الأجر والإجازات والسلف ونهاية الخدمة.
// منفصل عن صفحة الموظفين لأن بياناته تحكمها صلاحية «الرواتب» وحدها.
import { useEffect, useMemo, useState } from 'react';
import {
  getEmployeeContract, createEmployeeContract, updateEmployeeContract,
  createSalaryComponent, removeSalaryComponent,
  getEmployeeLeaves, createLeaveRecord, removeLeaveRecord,
  getEmployeeAdvances, createEmployeeAdvance, updateEmployeeAdvance,
  getEosEntitlement,
} from '@/lib/data';
import { fmtMoney, fmtDate, CURRENCY } from '@/lib/format';
import { Loading, Empty } from '../ui';
import { toast } from '../toast';

const CONTRACT_TYPE = {
  unlimited: 'غير محدد المدة',
  limited: 'محدد المدة',
  part_time: 'دوام جزئي',
  freelance: 'عمل حر',
};

// نسبة الأجر المدفوع تحدد الحسم: 100 لا حسم، 0 حسم كامل.
const LEAVE_TYPE = {
  annual: { label: 'إجازة سنوية', paid: 100 },
  sick: { label: 'إجازة مرضية', paid: 100 },
  unpaid: { label: 'بدون أجر', paid: 0 },
  absence: { label: 'غياب', paid: 0 },
  maternity: { label: 'وضع', paid: 100 },
  hajj: { label: 'حج', paid: 100 },
  marriage: { label: 'زواج', paid: 100 },
  bereavement: { label: 'وفاة', paid: 100 },
};

const EOS_REASON = {
  employer_termination: 'إنهاء من صاحب العمل',
  contract_end: 'انتهاء مدة العقد',
  resignation: 'استقالة',
};

const TABS = [
  ['contract', 'العقد والأجر'],
  ['leaves', 'الإجازات والغياب'],
  ['advances', 'السلف'],
  ['eos', 'نهاية الخدمة'],
];

function daysBetween(from, to) {
  if (!from || !to) return 0;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default function PayrollModal({ employee, cost, onClose, onChanged }) {
  const [tab, setTab] = useState('contract');
  const [contract, setContract] = useState(undefined);
  const [err, setErr] = useState('');

  async function loadContract() {
    try { setContract(await getEmployeeContract(employee.id)); }
    catch (e) { setErr(e.message || 'تعذّر تحميل العقد'); setContract(null); }
  }
  useEffect(() => { loadContract(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [employee.id]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card" style={{ maxWidth: 820, width: '100%' }}>
        <div className="modal-head">
          <div>
            <h2>الملف المالي — {employee.name}</h2>
            <p>العقد والأجر والاستقطاعات والتكلفة الفعلية على الشركة</p>
          </div>
          <button className="icon-close" type="button" onClick={onClose} aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {err && <div className="errbar">{err}</div>}

        <CostSummary cost={cost} />

        <div className="employee-toolbar" style={{ gap: 6, flexWrap: 'wrap' }}>
          {TABS.map(([key, label]) => (
            <button
              key={key} type="button"
              className={`btn ${tab === key ? '' : 'ghost'} sm`}
              onClick={() => setTab(key)}
            >{label}</button>
          ))}
        </div>

        <div style={{ marginTop: 14 }}>
          {contract === undefined ? <Loading /> : (
            <>
              {tab === 'contract' && (
                <ContractTab
                  employee={employee} contract={contract}
                  onSaved={async () => { await loadContract(); onChanged?.(); }}
                />
              )}
              {tab === 'leaves' && <LeavesTab employee={employee} onChanged={onChanged} />}
              {tab === 'advances' && <AdvancesTab employee={employee} cost={cost} onChanged={onChanged} />}
              {tab === 'eos' && <EosTab employee={employee} cost={cost} />}
            </>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn ghost" type="button" onClick={onClose}>إغلاق</button>
        </div>
      </div>
    </div>
  );
}

// الرقم الذي تقوم عليه الوحدة: الفرق بين الراتب المكتوب في العقد
// وما يكلّفه الموظف فعلاً على الشركة كل شهر.
function CostSummary({ cost }) {
  if (!cost) return null;
  const gross = num(cost.gross_pay);
  const total = num(cost.total_employer_cost);
  const overhead = total - gross;
  const rows = [
    ['الأجر الإجمالي', gross],
    ['حصة الشركة من التأمينات', num(cost.gosi_employer)],
    ['التأمين الطبي (شهرياً)', num(cost.insurance_monthly)],
    ['الرسوم الحكومية (شهرياً)', num(cost.govt_fees_monthly)],
    ['مخصص نهاية الخدمة', num(cost.eos_accrual)],
    ['مخصص التذاكر', num(cost.ticket_accrual)],
  ];
  return (
    <div className="card" style={{ padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'grid', gap: 6 }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
            <span style={{ color: 'var(--muted)' }}>{label}</span>
            <b dir="ltr">{fmtMoney(value)} {CURRENCY}</b>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, paddingTop: 8, borderTop: '1px solid var(--line, #e5e5e5)' }}>
          <span><b>التكلفة الشهرية الفعلية</b></span>
          <b dir="ltr">{fmtMoney(total)} {CURRENCY}</b>
        </div>
        {gross > 0 && (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
            التكلفة تزيد عن الراتب بـ {fmtMoney(overhead)} {CURRENCY} شهرياً، أي {Math.round((overhead / gross) * 100)}٪.
          </p>
        )}
      </div>
    </div>
  );
}

const CONTRACT_EMPTY = {
  contract_type: 'unlimited', start_date: '', end_date: '', probation_end_date: '',
  basic_salary: '', medical_insurance_yearly: '', govt_fees_yearly: '', ticket_yearly: '', note: '',
};

function ContractTab({ employee, contract, onSaved }) {
  const [form, setForm] = useState(CONTRACT_EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [comp, setComp] = useState({ kind: 'allowance', name: '', amount: '', is_gosi_applicable: false, is_eos_applicable: false });

  useEffect(() => {
    setForm(contract ? {
      contract_type: contract.contract_type || 'unlimited',
      start_date: contract.start_date || '',
      end_date: contract.end_date || '',
      probation_end_date: contract.probation_end_date || '',
      basic_salary: contract.basic_salary ?? '',
      medical_insurance_yearly: contract.medical_insurance_yearly ?? '',
      govt_fees_yearly: contract.govt_fees_yearly ?? '',
      ticket_yearly: contract.ticket_yearly ?? '',
      note: contract.note || '',
    } : CONTRACT_EMPTY);
  }, [contract]);

  function set(key, value) { setForm((f) => ({ ...f, [key]: value })); }

  async function save(e) {
    e.preventDefault();
    if (!form.start_date) { setErr('تاريخ بداية العقد مطلوب'); return; }
    setBusy(true); setErr('');
    const payload = {
      employee_id: employee.id,
      contract_type: form.contract_type,
      start_date: form.start_date,
      end_date: form.end_date || null,
      probation_end_date: form.probation_end_date || null,
      basic_salary: num(form.basic_salary),
      medical_insurance_yearly: num(form.medical_insurance_yearly),
      govt_fees_yearly: num(form.govt_fees_yearly),
      ticket_yearly: num(form.ticket_yearly),
      note: form.note.trim() || null,
    };
    try {
      if (contract) await updateEmployeeContract(contract.id, payload);
      else await createEmployeeContract(payload);
      toast('تم حفظ العقد');
      await onSaved();
    } catch (e2) { setErr(e2.message || 'تعذّر حفظ العقد'); }
    finally { setBusy(false); }
  }

  async function addComponent(e) {
    e.preventDefault();
    if (!contract) { setErr('احفظ العقد أولاً قبل إضافة البدلات'); return; }
    if (!comp.name.trim()) { setErr('اسم البند مطلوب'); return; }
    setBusy(true); setErr('');
    try {
      await createSalaryComponent({
        contract_id: contract.id, kind: comp.kind, name: comp.name.trim(), amount: num(comp.amount),
        is_gosi_applicable: comp.is_gosi_applicable, is_eos_applicable: comp.is_eos_applicable,
      });
      setComp({ kind: 'allowance', name: '', amount: '', is_gosi_applicable: false, is_eos_applicable: false });
      await onSaved();
    } catch (e2) { setErr(e2.message || 'تعذّر إضافة البند'); }
    finally { setBusy(false); }
  }

  async function delComponent(id) {
    try { await removeSalaryComponent(id); await onSaved(); }
    catch (e2) { setErr(e2.message || 'تعذّر الحذف'); }
  }

  const components = contract?.salary_components || [];

  return (
    <>
      {err && <div className="errbar">{err}</div>}
      <form onSubmit={save}>
        <div className="form-grid">
          <div className="field"><label>نوع العقد</label>
            <select value={form.contract_type} onChange={(e) => set('contract_type', e.target.value)}>
              {Object.entries(CONTRACT_TYPE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field"><label>الأجر الأساسي</label>
            <input type="number" min="0" step="0.01" dir="ltr" value={form.basic_salary} onChange={(e) => set('basic_salary', e.target.value)} />
          </div>
          <div className="field"><label>بداية العقد</label>
            <input type="date" lang="en-GB" dir="ltr" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} required />
          </div>
          <div className="field"><label>نهاية العقد</label>
            <input type="date" lang="en-GB" dir="ltr" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} />
          </div>
          <div className="field"><label>نهاية فترة التجربة</label>
            <input type="date" lang="en-GB" dir="ltr" value={form.probation_end_date} onChange={(e) => set('probation_end_date', e.target.value)} />
          </div>
          <div className="field"><label>التأمين الطبي سنوياً</label>
            <input type="number" min="0" step="0.01" dir="ltr" value={form.medical_insurance_yearly} onChange={(e) => set('medical_insurance_yearly', e.target.value)} />
          </div>
          <div className="field">
            <label>رسوم حكومية سنوية</label>
            <input type="number" min="0" step="0.01" dir="ltr" value={form.govt_fees_yearly} onChange={(e) => set('govt_fees_yearly', e.target.value)} />
            <small style={{ color: 'var(--muted)', fontSize: 11 }}>الإقامة ورخصة العمل. المقابل المالي الشهري يُضاف تلقائياً للوافد.</small>
          </div>
          <div className="field"><label>تذاكر السفر سنوياً</label>
            <input type="number" min="0" step="0.01" dir="ltr" value={form.ticket_yearly} onChange={(e) => set('ticket_yearly', e.target.value)} />
          </div>
          <div className="field span-2"><label>ملاحظات</label>
            <input value={form.note} onChange={(e) => set('note', e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 10 }}>
          <button className="btn sm" disabled={busy}>{busy ? 'جارٍ الحفظ…' : contract ? 'حفظ العقد' : 'إنشاء العقد'}</button>
        </div>
      </form>

      <h3 style={{ fontSize: 14, marginTop: 20, marginBottom: 8 }}>البدلات والاستقطاعات الثابتة</h3>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 0 }}>
        علامتا «تأمينات» و«نهاية خدمة» تحددان دخول البند في الحسابين. بدونهما تخرج الأرقام غلطاً.
      </p>
      {components.length === 0 ? (
        <Empty title="لا بدلات" desc="الأجر الأساسي فقط." />
      ) : (
        <table>
          <thead><tr><th>البند</th><th>النوع</th><th>المبلغ</th><th>تأمينات</th><th>نهاية خدمة</th><th /></tr></thead>
          <tbody>
            {components.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.kind === 'allowance' ? 'بدل' : 'استقطاع'}</td>
                <td dir="ltr">{fmtMoney(c.amount)}</td>
                <td>{c.is_gosi_applicable ? 'نعم' : '—'}</td>
                <td>{c.is_eos_applicable ? 'نعم' : '—'}</td>
                <td style={{ textAlign: 'left' }}><button className="x-btn" type="button" onClick={() => delComponent(c.id)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={addComponent} className="inline-add" style={{ marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
        <select value={comp.kind} onChange={(e) => setComp((c) => ({ ...c, kind: e.target.value }))} style={{ maxWidth: 120 }}>
          <option value="allowance">بدل</option>
          <option value="deduction">استقطاع</option>
        </select>
        <input placeholder="اسم البند (سكن، نقل…)" value={comp.name} onChange={(e) => setComp((c) => ({ ...c, name: e.target.value }))} style={{ maxWidth: 180 }} />
        <input type="number" min="0" step="0.01" dir="ltr" placeholder="المبلغ" value={comp.amount} onChange={(e) => setComp((c) => ({ ...c, amount: e.target.value }))} style={{ maxWidth: 110 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          <input type="checkbox" checked={comp.is_gosi_applicable} onChange={(e) => setComp((c) => ({ ...c, is_gosi_applicable: e.target.checked }))} />
          تأمينات
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          <input type="checkbox" checked={comp.is_eos_applicable} onChange={(e) => setComp((c) => ({ ...c, is_eos_applicable: e.target.checked }))} />
          نهاية خدمة
        </label>
        <button className="btn sm" disabled={busy || !contract}>إضافة</button>
      </form>
    </>
  );
}

const LEAVE_EMPTY = { leave_type: 'annual', from_date: '', to_date: '', paid_ratio: 100, note: '' };

function LeavesTab({ employee, onChanged }) {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(LEAVE_EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    try { setRows(await getEmployeeLeaves(employee.id)); }
    catch (e) { setErr(e.message || 'تعذّر التحميل'); setRows([]); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [employee.id]);

  const days = useMemo(() => daysBetween(form.from_date, form.to_date), [form.from_date, form.to_date]);

  function setType(value) {
    setForm((f) => ({ ...f, leave_type: value, paid_ratio: LEAVE_TYPE[value]?.paid ?? 100 }));
  }

  async function add(e) {
    e.preventDefault();
    if (days <= 0) { setErr('حدد فترة صحيحة'); return; }
    setBusy(true); setErr('');
    try {
      await createLeaveRecord({
        employee_id: employee.id, leave_type: form.leave_type,
        from_date: form.from_date, to_date: form.to_date, days,
        paid_ratio: num(form.paid_ratio), note: form.note.trim() || null,
      });
      setForm(LEAVE_EMPTY);
      await load(); onChanged?.();
    } catch (e2) { setErr(e2.message || 'تعذّر الحفظ'); }
    finally { setBusy(false); }
  }

  async function del(id) {
    try { await removeLeaveRecord(id); await load(); onChanged?.(); }
    catch (e2) { setErr(e2.message || 'تعذّر الحذف'); }
  }

  if (rows === null) return <Loading />;

  return (
    <>
      {err && <div className="errbar">{err}</div>}
      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 0 }}>
        الأصل أن الموظف حاضر. يُسجَّل هنا الاستثناء فقط، وما كان غير مدفوع يتحوّل حسماً في مسيّر الشهر.
      </p>
      {rows.length === 0 ? <Empty title="لا سجلات" desc="لا غياب ولا إجازات مسجّلة." /> : (
        <table>
          <thead><tr><th>النوع</th><th>من</th><th>إلى</th><th>الأيام</th><th>نسبة الأجر</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{LEAVE_TYPE[r.leave_type]?.label || r.leave_type}</td>
                <td>{fmtDate(r.from_date)}</td>
                <td>{fmtDate(r.to_date)}</td>
                <td dir="ltr">{r.days}</td>
                <td dir="ltr">{r.paid_ratio}٪</td>
                <td style={{ textAlign: 'left' }}><button className="x-btn" type="button" onClick={() => del(r.id)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={add} className="inline-add" style={{ marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
        <select value={form.leave_type} onChange={(e) => setType(e.target.value)} style={{ maxWidth: 150 }}>
          {Object.entries(LEAVE_TYPE).map(([v, o]) => <option key={v} value={v}>{o.label}</option>)}
        </select>
        <input type="date" lang="en-GB" dir="ltr" value={form.from_date} onChange={(e) => setForm((f) => ({ ...f, from_date: e.target.value }))} style={{ maxWidth: 150 }} />
        <input type="date" lang="en-GB" dir="ltr" value={form.to_date} onChange={(e) => setForm((f) => ({ ...f, to_date: e.target.value }))} style={{ maxWidth: 150 }} />
        <input type="number" min="0" max="100" dir="ltr" value={form.paid_ratio} onChange={(e) => setForm((f) => ({ ...f, paid_ratio: e.target.value }))} style={{ maxWidth: 90 }} aria-label="نسبة الأجر المدفوع" />
        {days > 0 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{days} يوم</span>}
        <button className="btn sm" disabled={busy}>إضافة</button>
      </form>
    </>
  );
}

function AdvancesTab({ employee, cost, onChanged }) {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState({ amount: '', installments_count: 1, start_month: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    try { setRows(await getEmployeeAdvances(employee.id)); }
    catch (e) { setErr(e.message || 'تعذّر التحميل'); setRows([]); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [employee.id]);

  const installment = useMemo(() => {
    const count = Math.max(1, Math.round(num(form.installments_count)));
    return num(form.amount) / count;
  }, [form.amount, form.installments_count]);

  // سقف الحسم النظامي: نصف الأجر. الفحص هنا تنبيه مبكر، والقاعدة الملزمة
  // في قاعدة البيانات توقف المسيّر نفسه.
  const cap = num(cost?.gross_pay) / 2;
  const overCap = cap > 0 && installment > cap;

  async function add(e) {
    e.preventDefault();
    if (num(form.amount) <= 0) { setErr('مبلغ السلفة مطلوب'); return; }
    if (!form.start_month) { setErr('شهر بداية الخصم مطلوب'); return; }
    setBusy(true); setErr('');
    try {
      await createEmployeeAdvance({
        employee_id: employee.id,
        amount: num(form.amount),
        installments_count: Math.max(1, Math.round(num(form.installments_count))),
        monthly_installment: Number(installment.toFixed(2)),
        start_month: `${form.start_month}-01`,
        note: form.note.trim() || null,
      });
      setForm({ amount: '', installments_count: 1, start_month: '', note: '' });
      await load(); onChanged?.();
    } catch (e2) { setErr(e2.message || 'تعذّر الحفظ'); }
    finally { setBusy(false); }
  }

  async function cancel(row) {
    if (!confirm('إلغاء هذه السلفة؟ سيتوقف خصم أقساطها.')) return;
    try { await updateEmployeeAdvance(row.id, { status: 'cancelled' }); await load(); onChanged?.(); }
    catch (e2) { setErr(e2.message || 'تعذّر الإلغاء'); }
  }

  if (rows === null) return <Loading />;

  return (
    <>
      {err && <div className="errbar">{err}</div>}
      {rows.length === 0 ? <Empty title="لا سلف" desc="لا سلف مسجّلة على هذا الموظف." /> : (
        <table>
          <thead><tr><th>المبلغ</th><th>القسط</th><th>المسدد</th><th>المتبقي</th><th>البداية</th><th>الحالة</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td dir="ltr">{fmtMoney(r.amount)}</td>
                <td dir="ltr">{fmtMoney(r.monthly_installment)}</td>
                <td dir="ltr">{fmtMoney(r.paid_amount)}</td>
                <td dir="ltr">{fmtMoney(num(r.amount) - num(r.paid_amount))}</td>
                <td>{fmtDate(r.start_month)}</td>
                <td>
                  <span className={`pill ${r.status === 'settled' ? 'p-done' : r.status === 'cancelled' ? 'p-cancel' : 'p-prog'}`}>
                    {r.status === 'settled' ? 'مسددة' : r.status === 'cancelled' ? 'ملغاة' : 'جارية'}
                  </span>
                </td>
                <td style={{ textAlign: 'left' }}>
                  {r.status === 'active' && <button className="btn ghost sm" type="button" onClick={() => cancel(r)}>إلغاء</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={add} className="inline-add" style={{ marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
        <input type="number" min="0" step="0.01" dir="ltr" placeholder="مبلغ السلفة" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} style={{ maxWidth: 130 }} />
        <input type="number" min="1" max="60" dir="ltr" placeholder="عدد الأقساط" value={form.installments_count} onChange={(e) => setForm((f) => ({ ...f, installments_count: e.target.value }))} style={{ maxWidth: 110 }} />
        <input type="month" lang="en-GB" dir="ltr" value={form.start_month} onChange={(e) => setForm((f) => ({ ...f, start_month: e.target.value }))} style={{ maxWidth: 150 }} aria-label="شهر بداية الخصم" />
        <input placeholder="ملاحظة" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} style={{ maxWidth: 160 }} />
        <button className="btn sm" disabled={busy || overCap}>إضافة</button>
      </form>
      {installment > 0 && (
        <p style={{ fontSize: 12, marginTop: 8, color: overCap ? 'var(--neg)' : 'var(--muted)' }}>
          القسط الشهري {fmtMoney(installment)} {CURRENCY}
          {cap > 0 && ` · سقف الحسم النظامي ${fmtMoney(cap)} ${CURRENCY}`}
          {overCap && ' — القسط يتجاوز نصف الأجر، زد عدد الأقساط.'}
        </p>
      )}
    </>
  );
}

function EosTab({ employee, cost }) {
  const [reason, setReason] = useState('employer_termination');
  const [amount, setAmount] = useState(undefined); // undefined=يحسب، null=محجوب، رقم=النتيجة
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    setAmount(undefined);
    getEosEntitlement(employee.id, reason)
      .then((v) => { if (!cancelled) setAmount(v); })
      .catch((e) => { if (!cancelled) { setErr(e.message || 'تعذّر الاحتساب'); setAmount(null); } });
    return () => { cancelled = true; };
  }, [employee.id, reason]);

  const accrued = num(cost?.eos_accrued_total);

  return (
    <>
      {err && <div className="errbar">{err}</div>}
      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 0 }}>
        نصف أجر شهر عن كل سنة من الخمس الأولى، وأجر شهر كامل عن كل سنة بعدها، على آخر أجر.
        المخصص التزام قائم من أول شهر، لا حدث يقع عند انتهاء الخدمة.
      </p>
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
          <span style={{ color: 'var(--muted)' }}>المخصص المتراكم حتى اليوم</span>
          <b dir="ltr">{fmtMoney(accrued)} {CURRENCY}</b>
        </div>
        <div className="field" style={{ marginBottom: 10 }}>
          <label>سبب انتهاء الخدمة</label>
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {Object.entries(EOS_REASON).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, paddingTop: 8, borderTop: '1px solid var(--line, #e5e5e5)' }}>
          <span><b>المستحق فعلياً</b></span>
          <b dir="ltr">{amount === undefined ? '…' : amount === null ? '—' : `${fmtMoney(amount)} ${CURRENCY}`}</b>
        </div>
        {reason === 'resignation' && (
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 0 }}>
            الاستقالة: لا شيء قبل سنتين، الثلث حتى خمس سنوات، الثلثان حتى عشر، وكامل المخصص بعدها.
          </p>
        )}
      </div>
    </>
  );
}
