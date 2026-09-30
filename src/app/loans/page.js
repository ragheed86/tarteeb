'use client';
// صفحة القروض والالتزامات — كل شيء في صفحة واحدة:
// القروض + جدول الأقساط + السداد + الرصيد المتبقي + التوقّع النقدي للالتزامات القادمة.
import { useEffect, useMemo, useState } from 'react';
import {
  getLoans, createLoan, updateLoan, removeLoan,
  getLoanInstallments, replaceLoanInstallments,
  getLoanPayments, createLoanPayment, removeLoanPayment,
  getBankAccounts, getBankTransactions, createBankMatches,
} from '@/lib/data';
import { fmtMoney, fmtNum } from '@/lib/format';
import { Loading, Empty, ErrorBar, Modal, DataTable, Input, Select, TextArea, Money, DateText, StatusPill, KpiCard } from '@/components';
import { toast } from '@/app/toast';

const FREQUENCY = { monthly: 'شهري', quarterly: 'ربع سنوي', semiannual: 'نصف سنوي', yearly: 'سنوي' };
const FREQ_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 };
const LOAN_STATUS = {
  active: { label: 'قائم', cls: 'p-prog' },
  closed: { label: 'مسدَّد', cls: 'p-done' },
  defaulted: { label: 'متعثّر', cls: 'p-cancel' },
};
const INSTALLMENT_STATUS = {
  paid: { label: 'مدفوع', cls: 'p-done' },
  partial: { label: 'جزئي', cls: 'p-prog' },
  overdue: { label: 'متأخر', cls: 'p-cancel' },
  due_soon: { label: 'مستحق قريباً', cls: 'p-wait' },
  upcoming: { label: 'قادم', cls: 'p-wait' },
};
const METHODS = {
  bank_transfer: 'تحويل بنكي', card: 'بطاقة', mada: 'مدى', cash: 'نقداً',
  stc_pay: 'STC Pay', apple_pay: 'Apple Pay', other: 'أخرى',
};
const FORECAST_MONTHS = 6;

const n = (v) => Number(v || 0);
const r2 = (v) => Math.round(n(v) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, days) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
const monthLabel = (ym) => `${ym.slice(5, 7)}/${ym.slice(0, 4)}`;

// إضافة أشهر مع تثبيت آخر يوم في الشهر (31 يناير + شهر = 28/29 فبراير).
function addMonths(iso, months) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

// توليد جدول الأقساط: القسط = (الأصل + الرسوم) ÷ عدد الأقساط، والفرق يُسوّى في القسط الأخير.
function buildSchedule({ start_date, installments_count, principal_amount, fees_amount, frequency }) {
  const count = Math.max(1, Number(installments_count) || 0);
  const step = FREQ_MONTHS[frequency] || 1;
  const principal = n(principal_amount);
  const fees = n(fees_amount);
  const total = r2(principal + fees);
  const baseAmount = r2(total / count);
  const basePrincipal = r2(principal / count);
  const rows = [];
  let amountLeft = total;
  let principalLeft = principal;
  for (let i = 0; i < count; i += 1) {
    const last = i === count - 1;
    const amount = last ? r2(amountLeft) : baseAmount;
    const principalPart = last ? r2(principalLeft) : basePrincipal;
    amountLeft = r2(amountLeft - amount);
    principalLeft = r2(principalLeft - principalPart);
    rows.push({
      seq: i + 1,
      due_date: addMonths(start_date, step * (i + 1)),
      amount,
      principal_component: Math.max(0, Math.min(principalPart, amount)),
      fee_component: Math.max(0, r2(amount - principalPart)),
    });
  }
  return rows;
}

function installmentState(row, now) {
  const remaining = r2(n(row.amount) - n(row.paid_amount));
  if (row.status === 'paid' || remaining <= 0.009) return 'paid';
  if (row.due_date < now) return 'overdue';
  if (row.status === 'partial') return 'partial';
  if (row.due_date <= addDays(now, 7)) return 'due_soon';
  return 'upcoming';
}

const EMPTY_LOAN = {
  name: '', lender: '', principal_amount: '', fees_amount: '0',
  start_date: today(), installments_count: '12', frequency: 'monthly',
  bank_account_id: '', status: 'active', note: '',
};

export default function LoansPage() {
  const [state, setState] = useState(null);
  const [err, setErr] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [scheduleFilter, setScheduleFilter] = useState('open');
  const [saving, setSaving] = useState(false);

  const [loanOpen, setLoanOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [loanForm, setLoanForm] = useState(EMPTY_LOAN);
  const [loanErr, setLoanErr] = useState('');
  const [regenerate, setRegenerate] = useState(false);

  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState(null);
  const [payErr, setPayErr] = useState('');

  const now = today();

  async function load(preferred) {
    try {
      const [loans, installments, payments, accounts, bankTx] = await Promise.all([
        getLoans(), getLoanInstallments(), getLoanPayments(),
        getBankAccounts().catch(() => []), getBankTransactions().catch(() => []),
      ]);
      setState({ loans, installments, payments, accounts, bankTx });
      setSelectedId((current) => preferred || (loans.some((l) => l.id === current) ? current : loans[0]?.id || ''));
    } catch (e) { setErr(e.message || 'تعذّر تحميل القروض'); }
  }
  useEffect(() => { load(); }, []);

  // ---------- الحسابات المشتقة ----------
  const derived = useMemo(() => {
    if (!state) return null;
    const paidByLoan = new Map();
    for (const p of state.payments) paidByLoan.set(p.loan_id, r2(n(paidByLoan.get(p.loan_id)) + n(p.amount)));
    const loans = state.loans.map((loan) => {
      const total = r2(n(loan.principal_amount) + n(loan.fees_amount));
      const paid = n(paidByLoan.get(loan.id));
      const rows = state.installments.filter((i) => i.loan_id === loan.id);
      const overdue = rows.filter((i) => installmentState(i, now) === 'overdue');
      const next = rows.filter((i) => installmentState(i, now) !== 'paid').sort((a, b) => a.due_date.localeCompare(b.due_date))[0] || null;
      return {
        ...loan, total, paid,
        remaining: Math.max(0, r2(total - paid)),
        progress: total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0,
        overdueCount: overdue.length,
        overdueAmount: r2(overdue.reduce((s, i) => s + (n(i.amount) - n(i.paid_amount)), 0)),
        next,
        installmentsRows: rows,
      };
    });
    const open = loans.filter((l) => l.status !== 'closed');
    const horizon = addDays(now, 30);
    const openInstallments = state.installments.filter((i) => installmentState(i, now) !== 'paid');
    const due30 = openInstallments.filter((i) => i.due_date <= horizon && i.due_date >= now);
    const overdueAll = openInstallments.filter((i) => i.due_date < now);

    // توقّع التدفق النقدي: التزامات الأشهر القادمة من الأقساط غير المسدَّدة.
    const buckets = new Map();
    for (let i = 0; i < FORECAST_MONTHS; i += 1) {
      const ym = addMonths(`${now.slice(0, 7)}-01`, i).slice(0, 7);
      buckets.set(ym, { ym, amount: 0, count: 0, overdue: 0 });
    }
    for (const inst of openInstallments) {
      const remaining = r2(n(inst.amount) - n(inst.paid_amount));
      const ym = inst.due_date < now ? now.slice(0, 7) : inst.due_date.slice(0, 7);
      const bucket = buckets.get(ym);
      if (!bucket) continue;
      bucket.amount = r2(bucket.amount + remaining);
      bucket.count += 1;
      if (inst.due_date < now) bucket.overdue = r2(bucket.overdue + remaining);
    }
    const forecast = [...buckets.values()];
    const forecastMax = Math.max(1, ...forecast.map((b) => b.amount));

    return {
      loans,
      totalPrincipal: r2(open.reduce((s, l) => s + n(l.principal_amount), 0)),
      totalFees: r2(open.reduce((s, l) => s + n(l.fees_amount), 0)),
      totalRemaining: r2(open.reduce((s, l) => s + l.remaining, 0)),
      totalPaid: r2(loans.reduce((s, l) => s + l.paid, 0)),
      due30Amount: r2(due30.reduce((s, i) => s + (n(i.amount) - n(i.paid_amount)), 0)),
      due30Count: due30.length,
      overdueAmount: r2(overdueAll.reduce((s, i) => s + (n(i.amount) - n(i.paid_amount)), 0)),
      overdueCount: overdueAll.length,
      forecast, forecastMax,
    };
  }, [state, now]);

  const selected = derived?.loans.find((l) => l.id === selectedId) || null;
  const schedule = useMemo(() => {
    if (!selected) return [];
    return selected.installmentsRows
      .map((row) => ({ ...row, state: installmentState(row, now), remaining: Math.max(0, r2(n(row.amount) - n(row.paid_amount))) }))
      .filter((row) => scheduleFilter === 'all' || (scheduleFilter === 'open' ? row.state !== 'paid' : row.state === scheduleFilter))
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
  }, [selected, scheduleFilter, now]);
  const loanPayments = useMemo(
    () => (state && selected ? state.payments.filter((p) => p.loan_id === selected.id) : []),
    [state, selected],
  );

  // الحركات البنكية الصادرة غير المرتبطة — مرشّحة لربط الدفعة.
  const linkableTx = useMemo(() => {
    if (!state) return [];
    return state.bankTx.filter((t) => n(t.amount) < 0 && t.status !== 'matched' && t.status !== 'excluded');
  }, [state]);
  // دفعة القرض ← الحركة البنكية المطابقة لها (من جدول المطابقات)
  const txById = useMemo(() => {
    const map = new Map();
    for (const t of state?.bankTx || []) for (const m of t.bank_reconciliation_matches || []) if (m.loan_payment_id) map.set(m.loan_payment_id, t);
    return map;
  }, [state]);

  // ---------- القرض ----------
  function openNewLoan() {
    setEditing(null); setLoanForm({ ...EMPTY_LOAN, start_date: today() });
    setLoanErr(''); setRegenerate(true); setLoanOpen(true);
  }
  function openEditLoan(loan) {
    setEditing(loan);
    setLoanForm({
      name: loan.name || '', lender: loan.lender || '', principal_amount: String(loan.principal_amount || ''),
      fees_amount: String(loan.fees_amount || 0), start_date: loan.start_date || today(),
      installments_count: String(loan.installments_count || 12), frequency: loan.frequency || 'monthly',
      bank_account_id: loan.bank_account_id || '', status: loan.status || 'active', note: loan.note || '',
    });
    setLoanErr(''); setRegenerate(false); setLoanOpen(true);
  }
  const previewSchedule = useMemo(() => {
    const count = Number(loanForm.installments_count);
    if (!(n(loanForm.principal_amount) > 0) || !(count > 0) || !loanForm.start_date) return [];
    return buildSchedule(loanForm);
  }, [loanForm]);

  async function submitLoan(e) {
    e.preventDefault();
    const count = Number(loanForm.installments_count);
    if (!loanForm.name.trim() || !(n(loanForm.principal_amount) > 0)) { setLoanErr('أدخل اسم القرض وقيمة أصلية صحيحة'); return; }
    if (!(count >= 1 && count <= 480)) { setLoanErr('عدد الأقساط يجب أن يكون بين 1 و 480'); return; }
    if (n(loanForm.fees_amount) < 0) { setLoanErr('الرسوم لا يمكن أن تكون سالبة'); return; }
    setSaving(true); setLoanErr('');
    try {
      const rows = buildSchedule(loanForm);
      const payload = {
        name: loanForm.name.trim(), lender: loanForm.lender.trim() || null,
        principal_amount: n(loanForm.principal_amount), fees_amount: n(loanForm.fees_amount) || 0,
        start_date: loanForm.start_date, end_date: rows[rows.length - 1]?.due_date || null,
        installments_count: count, frequency: loanForm.frequency,
        bank_account_id: loanForm.bank_account_id || null, status: loanForm.status,
        note: loanForm.note.trim() || null,
      };
      const saved = editing ? await updateLoan(editing.id, payload) : await createLoan(payload);
      if (!editing || regenerate) await replaceLoanInstallments(saved.id, rows);
      setLoanOpen(false);
      toast(editing ? 'تم تحديث القرض' : 'تم إنشاء القرض وجدول الأقساط');
      await load(saved.id);
    } catch (e2) { setLoanErr(e2.message || 'تعذّر حفظ القرض'); }
    finally { setSaving(false); }
  }
  async function deleteLoan(loan) {
    if (!confirm(`حذف القرض «${loan.name}» مع كل أقساطه ودفعاته؟`)) return;
    try {
      // حذف الدفعات يفك مطابقاتها البنكية تلقائياً وتعود الحركات للمراجعة (ما لم يكن الشهر مقفلاً).
      await removeLoan(loan.id);
      toast('تم حذف القرض'); await load('');
    } catch (e) { toast(e.message || 'تعذّر الحذف', 'err'); }
  }

  // ---------- السداد ----------
  function openPayment(loan, installment) {
    const target = installment || loan.next;
    setPayForm({
      loan_id: loan.id,
      installment_id: target?.id || '',
      amount: target ? String(Math.max(0, r2(n(target.amount) - n(target.paid_amount)))) : '',
      paid_at: today(), method: 'bank_transfer', reference: '', note: '', bank_transaction_id: '',
    });
    setPayErr(''); setPayOpen(true);
  }
  async function submitPayment(e) {
    e.preventDefault();
    if (!(n(payForm.amount) > 0)) { setPayErr('أدخل مبلغ سداد صحيح'); return; }
    setSaving(true); setPayErr('');
    let created = null;
    try {
      created = await createLoanPayment({
        loan_id: payForm.loan_id,
        installment_id: payForm.installment_id || null,
        amount: n(payForm.amount), paid_at: payForm.paid_at, method: payForm.method,
        reference: payForm.reference.trim() || null, note: payForm.note.trim() || null,
      });
      if (payForm.bank_transaction_id) {
        const tx = linkableTx.find((t) => t.id === payForm.bank_transaction_id);
        const open = tx ? Math.abs(n(tx.amount)) - n(tx.matched_amount) : n(payForm.amount);
        await createBankMatches([{
          bank_transaction_id: payForm.bank_transaction_id, loan_payment_id: created.id,
          amount: r2(Math.min(n(payForm.amount), open)), method: 'manual', confidence: 100,
        }]);
      }
      setPayOpen(false); toast('تم تسجيل السداد وتحديث الرصيد');
      await load(payForm.loan_id);
    } catch (e2) {
      if (created && payForm.bank_transaction_id) removeLoanPayment(created.id).catch(() => {});
      setPayErr(e2.message || 'تعذّر تسجيل السداد');
    }
    finally { setSaving(false); }
  }
  async function deletePayment(payment) {
    if (!confirm(`حذف دفعة بقيمة ${fmtMoney(payment.amount)}؟`)) return;
    try {
      await removeLoanPayment(payment.id); // المطابقة البنكية تُحذف معها تلقائياً
      toast('تم حذف الدفعة'); await load(selectedId);
    } catch (e) { toast(e.message || 'تعذّر حذف الدفعة', 'err'); }
  }

  if (err) return <ErrorBar message={err} />;
  if (!state || !derived) return <Loading />;

  return (
    <>
      <style>{CSS}</style>
      <div className="sec-head loan-head">
        <div><h2>القروض والالتزامات</h2><p>جدولة الأقساط، تسجيل السداد، والرصيد المتبقي مربوطاً بالحركة البنكية</p></div>
        <button className="btn" onClick={openNewLoan}>+ قرض جديد</button>
      </div>

      <div className="kpis loan-kpis">
        <KpiCard
          label="الرصيد المتبقي" value={`${fmtMoney(derived.totalRemaining)} ⃁`}
          trend={`${fmtNum(derived.loans.filter((l) => l.status !== 'closed').length)} قرض قائم`}
          definition="إجمالي ما تبقّى من التزامات القروض القائمة (الأصل + الرسوم) بعد خصم كل الدفعات المسجّلة."
          period="كل القروض غير المسدَّدة" formula="(الأصل + تكلفة التمويل) − إجمالي السداد"
          breakdown={derived.loans.filter((l) => l.status !== 'closed').slice(0, 6).map((l) => ({ label: l.name, value: `${fmtMoney(l.remaining)} ⃁` }))}
        />
        <KpiCard
          label="أصل الدين وتكلفة التمويل" value={`${fmtMoney(derived.totalPrincipal)} ⃁`}
          trend={`رسوم وتمويل ${fmtMoney(derived.totalFees)} ⃁`}
          definition="القيمة الأصلية للقروض القائمة، وبجانبها إجمالي الرسوم وتكلفة التمويل المضافة عليها."
          period="كل القروض غير المسدَّدة" formula="جمع القيمة الأصلية لكل قرض قائم"
          breakdown={[
            { label: 'أصل الدين', value: `${fmtMoney(derived.totalPrincipal)} ⃁` },
            { label: 'الرسوم وتكلفة التمويل', value: `${fmtMoney(derived.totalFees)} ⃁` },
            { label: 'إجمالي المسدَّد حتى اليوم', value: `${fmtMoney(derived.totalPaid)} ⃁` },
          ]}
        />
        <KpiCard
          label="مستحق خلال 30 يوم" value={`${fmtMoney(derived.due30Amount)} ⃁`}
          trend={`${fmtNum(derived.due30Count)} قسط`}
          definition="الأقساط التي يحلّ موعد استحقاقها خلال الثلاثين يوماً القادمة ولم تُسدَّد بعد."
          period={`${now} → ${addDays(now, 30)}`} formula="جمع المتبقي من الأقساط المستحقة خلال 30 يوماً"
          note="هذا المبلغ يدخل ضمن توقّع التدفق النقدي بالأسفل."
        />
        <KpiCard
          tone={derived.overdueCount ? 'alert' : undefined}
          label="أقساط متأخرة" value={`${fmtMoney(derived.overdueAmount)} ⃁`}
          trend={derived.overdueCount ? `${fmtNum(derived.overdueCount)} قسط متأخر` : 'لا توجد متأخرات'}
          definition="الأقساط التي تجاوزت تاريخ استحقاقها ولم يكتمل سدادها."
          period="حتى تاريخ اليوم" formula="جمع المتبقي من الأقساط التي تاريخ استحقاقها قبل اليوم"
        />
      </div>

      {derived.overdueCount > 0 && (
        <div className="loan-alert">
          لديك {fmtNum(derived.overdueCount)} قسط متأخر بقيمة {fmtMoney(derived.overdueAmount)} ⃁ — راجع جدول الأقساط بالأسفل.
        </div>
      )}

      {state.loans.length === 0 ? (
        <div className="card">
          <Empty title="لا توجد قروض مسجّلة" desc="أضف القرض الأول وسيُنشأ جدول الأقساط تلقائياً." />
          <div className="empty-action"><button className="btn" onClick={openNewLoan}>إضافة قرض</button></div>
        </div>
      ) : (
        <>
          {/* ---------- بطاقات القروض ---------- */}
          <div className="loan-grid">
            {derived.loans.map((loan) => (
              <button
                key={loan.id} type="button"
                className={`loan-card${loan.id === selectedId ? ' active' : ''}${loan.overdueCount ? ' late' : ''}`}
                onClick={() => setSelectedId(loan.id)}
              >
                <div className="loan-card-top">
                  <div><b>{loan.name}</b>{loan.lender && <small>{loan.lender}</small>}</div>
                  <StatusPill status={loan.status} map={LOAN_STATUS} />
                </div>
                <div className="loan-card-amount"><Money v={loan.remaining} /><small>متبقٍ من {fmtMoney(loan.total)} ⃁</small></div>
                <div className="loan-bar"><span style={{ width: `${loan.progress}%` }} /></div>
                <div className="loan-card-foot">
                  <span>سُدّد {fmtNum(loan.progress)}%</span>
                  <span>{loan.next ? <>القسط القادم <DateText v={loan.next.due_date} /></> : 'مكتمل'}</span>
                </div>
                {loan.overdueCount > 0 && <div className="loan-card-late">{fmtNum(loan.overdueCount)} قسط متأخر · {fmtMoney(loan.overdueAmount)} ⃁</div>}
              </button>
            ))}
          </div>

          {selected && (
            <>
              {/* ---------- تفاصيل القرض المحدد ---------- */}
              <div className="card loan-detail">
                <div className="loan-detail-head">
                  <div>
                    <h3>{selected.name}</h3>
                    <p>
                      {selected.lender || 'بلا جهة ممولة محددة'} · {FREQUENCY[selected.frequency]} ·{' '}
                      {fmtNum(selected.installments_count)} قسط · من <DateText v={selected.start_date} /> إلى <DateText v={selected.end_date} />
                    </p>
                  </div>
                  <div className="loan-detail-actions">
                    <button className="btn" disabled={selected.status === 'closed'} onClick={() => openPayment(selected)}>+ تسجيل سداد</button>
                    <button className="btn ghost sm" onClick={() => openEditLoan(selected)}>تعديل / إعادة جدولة</button>
                    <button className="btn ghost sm danger-text" onClick={() => deleteLoan(selected)}>حذف</button>
                  </div>
                </div>
                <div className="loan-figures">
                  <div><span>القيمة الأصلية</span><b>{fmtMoney(selected.principal_amount)} ⃁</b></div>
                  <div><span>الرسوم وتكلفة التمويل</span><b>{fmtMoney(selected.fees_amount)} ⃁</b></div>
                  <div><span>إجمالي الواجب سداده</span><b>{fmtMoney(selected.total)} ⃁</b></div>
                  <div><span>المسدَّد</span><b className="pos">{fmtMoney(selected.paid)} ⃁</b></div>
                  <div><span>الرصيد المتبقي</span><b className="neg">{fmtMoney(selected.remaining)} ⃁</b></div>
                  <div><span>الحساب البنكي</span><b>{state.accounts.find((a) => a.id === selected.bank_account_id)?.name || '—'}</b></div>
                </div>
                {selected.note && <div className="loan-note">{selected.note}</div>}
              </div>

              {/* ---------- جدول الأقساط ---------- */}
              <div className="viewtoggle loan-tabs">
                {[['open', 'غير مسدَّدة'], ['overdue', 'متأخرة'], ['due_soon', 'مستحقة قريباً'], ['paid', 'مدفوعة'], ['all', 'كل الأقساط']]
                  .map(([key, label]) => (
                    <button key={key} className={`vt${scheduleFilter === key ? ' active' : ''}`} onClick={() => setScheduleFilter(key)}>{label}</button>
                  ))}
              </div>
              <div className="card" style={{ padding: '6px 0' }}>
                <DataTable
                  rows={schedule} pageSize={12}
                  empty={<Empty title="لا توجد أقساط بهذا الفلتر" desc="غيّر الفلتر لعرض بقية الجدول." />}
                  rowClassName={(r) => (r.state === 'overdue' ? 'row-low' : '')}
                  columns={[
                    { key: 'seq', label: 'القسط', primary: true, render: (r) => <><span className="nm">القسط {fmtNum(r.seq)}</span><br /><small>من {fmtNum(selected.installments_count)}</small></> },
                    { key: 'due_date', label: 'الاستحقاق', render: (r) => <DateText v={r.due_date} /> },
                    { key: 'amount', label: 'قيمة القسط', render: (r) => <Money v={r.amount} /> },
                    { key: 'fee_component', label: 'منه تمويل', hideMobile: true, render: (r) => <Money v={r.fee_component} /> },
                    { key: 'paid_amount', label: 'المسدَّد', render: (r) => <Money v={r.paid_amount} className={n(r.paid_amount) > 0 ? 'pos' : undefined} /> },
                    { key: 'remaining', label: 'المتبقي', render: (r) => <Money v={r.remaining} className={r.remaining > 0 ? 'neg' : undefined} /> },
                    { key: 'state', label: 'الحالة', render: (r) => <StatusPill status={r.state} map={INSTALLMENT_STATUS} /> },
                    {
                      key: 'actions', label: '', align: 'left',
                      render: (r) => (r.state === 'paid' ? <span className="muted-cell">—</span>
                        : <button className="btn sm" onClick={() => openPayment(selected, r)}>سداد</button>),
                    },
                  ]}
                />
              </div>

              {/* ---------- سجل الدفعات ---------- */}
              <div className="card loan-payments">
                <div className="loan-sub-head"><h3>سجل السداد</h3><p>كل دفعة تُسجَّل مرة واحدة وتُربط بحركة بنكية واحدة فقط — بلا ازدواجية في التقارير.</p></div>
                <DataTable
                  rows={loanPayments} pageSize={10}
                  empty={<Empty title="لا توجد دفعات بعد" desc="سجّل أول سداد لهذا القرض." />}
                  columns={[
                    { key: 'paid_at', label: 'التاريخ', primary: true, render: (r) => <DateText v={r.paid_at} /> },
                    { key: 'amount', label: 'المبلغ', render: (r) => <Money v={r.amount} /> },
                    {
                      key: 'installment_id', label: 'القسط',
                      render: (r) => {
                        const inst = selected.installmentsRows.find((i) => i.id === r.installment_id);
                        return inst ? `القسط ${fmtNum(inst.seq)}` : 'سداد عام';
                      },
                    },
                    { key: 'method', label: 'الطريقة', render: (r) => METHODS[r.method] || '—' },
                    {
                      key: 'bank', label: 'الحركة البنكية',
                      render: (r) => {
                        const tx = txById.get(r.id);
                        return tx ? <span className="bank-linked">مرتبطة · <small dir="ltr">{tx.reference || tx.description}</small></span> : <span className="muted-cell">غير مرتبطة</span>;
                      },
                    },
                    { key: 'actions', label: '', align: 'left', render: (r) => <button className="btn ghost sm danger-text" onClick={() => deletePayment(r)}>حذف</button> },
                  ]}
                />
              </div>
            </>
          )}

          {/* ---------- توقّع التدفق النقدي ---------- */}
          <div className="card loan-forecast">
            <div className="loan-sub-head">
              <h3>توقّع التدفق النقدي · الالتزامات القادمة</h3>
              <p>الأقساط غير المسدَّدة لكل القروض موزّعة على الأشهر الستة القادمة. المتأخرات تُحمَّل على الشهر الحالي.</p>
            </div>
            <div className="forecast-rows">
              {derived.forecast.map((b) => (
                <div key={b.ym} className="forecast-row">
                  <span className="forecast-month">{monthLabel(b.ym)}</span>
                  <div className="forecast-bar">
                    <span style={{ width: `${Math.round((b.amount / derived.forecastMax) * 100)}%` }} className={b.overdue > 0 ? 'late' : undefined} />
                  </div>
                  <span className="forecast-amount">{fmtMoney(b.amount)} ⃁</span>
                  <small className="forecast-count">{b.count ? `${fmtNum(b.count)} قسط` : 'لا التزامات'}{b.overdue > 0 ? ` · منها ${fmtMoney(b.overdue)} متأخرة` : ''}</small>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ---------- مودال القرض ---------- */}
      <Modal
        open={loanOpen} onClose={() => !saving && setLoanOpen(false)}
        title={editing ? 'تعديل القرض' : 'قرض جديد'}
        subtitle="القيمة الأصلية والرسوم تُوزَّع تلقائياً على الأقساط"
        as="form" onSubmit={submitLoan} size="lg"
        footer={<><button type="button" className="btn ghost" onClick={() => setLoanOpen(false)} disabled={saving}>إلغاء</button><button className="btn" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ القرض'}</button></>}
      >
        {loanErr && <div className="errbar">{loanErr}</div>}
        <div className="form-grid">
          <Input className="span-2" label="اسم القرض" value={loanForm.name} onChange={(e) => setLoanForm((f) => ({ ...f, name: e.target.value }))} placeholder="تمويل تشغيلي" required autoFocus />
          <Input label="الجهة الممولة" value={loanForm.lender} onChange={(e) => setLoanForm((f) => ({ ...f, lender: e.target.value }))} placeholder="بنك / جهة تمويل" />
          <Select
            label="الحساب البنكي للسداد" value={loanForm.bank_account_id}
            onChange={(e) => setLoanForm((f) => ({ ...f, bank_account_id: e.target.value }))}
            options={[{ value: '', label: 'بدون تحديد' }, ...state.accounts.map((a) => ({ value: a.id, label: `${a.name}${a.last_four ? ` • ${a.last_four}` : ''}` }))]}
          />
          <Input label="القيمة الأصلية" type="number" min="0.01" step="0.01" ltr value={loanForm.principal_amount} onChange={(e) => setLoanForm((f) => ({ ...f, principal_amount: e.target.value }))} required />
          <Input label="الرسوم وتكلفة التمويل" type="number" min="0" step="0.01" ltr value={loanForm.fees_amount} onChange={(e) => setLoanForm((f) => ({ ...f, fees_amount: e.target.value }))} hint="إجمالي الرسوم والأرباح المضافة على أصل الدين" />
          <Input label="تاريخ البداية" type="date" ltr value={loanForm.start_date} onChange={(e) => setLoanForm((f) => ({ ...f, start_date: e.target.value }))} required />
          <Input label="عدد الأقساط" type="number" min="1" max="480" ltr value={loanForm.installments_count} onChange={(e) => setLoanForm((f) => ({ ...f, installments_count: e.target.value }))} required />
          <Select label="دورية القسط" value={loanForm.frequency} onChange={(e) => setLoanForm((f) => ({ ...f, frequency: e.target.value }))} options={Object.entries(FREQUENCY).map(([value, label]) => ({ value, label }))} />
          <Select label="حالة القرض" value={loanForm.status} onChange={(e) => setLoanForm((f) => ({ ...f, status: e.target.value }))} options={Object.entries(LOAN_STATUS).map(([value, x]) => ({ value, label: x.label }))} />
          <TextArea className="span-2" label="ملاحظات" rows="2" value={loanForm.note} onChange={(e) => setLoanForm((f) => ({ ...f, note: e.target.value }))} />
        </div>

        {previewSchedule.length > 0 && (
          <div className="schedule-preview">
            <div className="schedule-preview-head">
              <b>معاينة الجدول</b>
              <span>
                {fmtNum(previewSchedule.length)} قسط · القسط {fmtMoney(previewSchedule[0].amount)} ⃁ ·
                إجمالي {fmtMoney(previewSchedule.reduce((s, x) => s + x.amount, 0))} ⃁ ·
                آخر قسط {previewSchedule[previewSchedule.length - 1].due_date}
              </span>
            </div>
            {editing && (
              <label className="schedule-regen">
                <input type="checkbox" checked={regenerate} onChange={(e) => setRegenerate(e.target.checked)} />
                إعادة توليد جدول الأقساط (يحذف الأقساط الحالية ويفك ارتباط الدفعات بها)
              </label>
            )}
          </div>
        )}
      </Modal>

      {/* ---------- مودال السداد ---------- */}
      <Modal
        open={payOpen} onClose={() => !saving && setPayOpen(false)}
        title="تسجيل سداد" subtitle="يُحدَّث الرصيد المتبقي وحالة القسط فوراً"
        as="form" onSubmit={submitPayment}
        footer={<><button type="button" className="btn ghost" onClick={() => setPayOpen(false)} disabled={saving}>إلغاء</button><button className="btn" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ السداد'}</button></>}
      >
        {payErr && <div className="errbar">{payErr}</div>}
        {payForm && (
          <div className="form-grid">
            <Select
              className="span-2" label="القسط" value={payForm.installment_id}
              onChange={(e) => {
                const inst = selected?.installmentsRows.find((i) => i.id === e.target.value);
                setPayForm((f) => ({ ...f, installment_id: e.target.value, amount: inst ? String(Math.max(0, r2(n(inst.amount) - n(inst.paid_amount)))) : f.amount }));
              }}
              options={[
                { value: '', label: 'سداد عام (بدون قسط محدد)' },
                ...(selected?.installmentsRows || [])
                  .filter((i) => i.status !== 'paid')
                  .sort((a, b) => a.due_date.localeCompare(b.due_date))
                  .map((i) => ({ value: i.id, label: `القسط ${i.seq} · استحقاق ${i.due_date} · متبقٍ ${fmtMoney(r2(n(i.amount) - n(i.paid_amount)))}` })),
              ]}
            />
            <Input label="المبلغ" type="number" min="0.01" step="0.01" ltr value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} required />
            <Input label="تاريخ السداد" type="date" ltr value={payForm.paid_at} onChange={(e) => setPayForm((f) => ({ ...f, paid_at: e.target.value }))} required />
            <Select label="طريقة السداد" value={payForm.method} onChange={(e) => setPayForm((f) => ({ ...f, method: e.target.value }))} options={Object.entries(METHODS).map(([value, label]) => ({ value, label }))} />
            <Input label="المرجع" value={payForm.reference} onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))} placeholder="رقم العملية" />
            <Select
              className="span-2" label="ربط بحركة بنكية" value={payForm.bank_transaction_id}
              onChange={(e) => {
                const tx = linkableTx.find((t) => t.id === e.target.value);
                setPayForm((f) => ({ ...f, bank_transaction_id: e.target.value, amount: tx ? String(Math.abs(n(tx.amount))) : f.amount, paid_at: tx ? tx.transaction_date : f.paid_at }));
              }}
              options={[
                { value: '', label: 'بدون ربط الآن' },
                ...linkableTx.slice(0, 60).map((t) => ({ value: t.id, label: `${t.transaction_date} · ${fmtMoney(Math.abs(n(t.amount)))} · ${t.description}` })),
              ]}
            />
            <TextArea className="span-2" label="ملاحظات" rows="2" value={payForm.note} onChange={(e) => setPayForm((f) => ({ ...f, note: e.target.value }))} />
          </div>
        )}
      </Modal>
    </>
  );
}

const CSS = `
.loan-head{margin-bottom:16px;align-items:flex-end}.loan-head h2{margin:0}.loan-head p{margin:5px 0 0;color:var(--muted);font-size:13px}
.loan-kpis{grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:14px}
.loan-alert{margin-bottom:14px;padding:11px 15px;border-radius:11px;background:var(--neg-bg);color:var(--neg);font-size:13px}
.empty-action{text-align:center;padding-bottom:20px}.danger-text{color:var(--neg)!important}.muted-cell{color:var(--muted)}
.loan-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-bottom:16px}
.loan-card{text-align:inherit;display:grid;gap:9px;padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--surface);cursor:pointer;font:inherit;transition:border-color .15s,box-shadow .15s}
.loan-card:hover{border-color:rgba(14,126,130,.4)}.loan-card.active{border-color:var(--green);box-shadow:0 0 0 1px var(--green) inset}.loan-card.late{background:var(--neg-bg)}
.loan-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}.loan-card-top b{display:block;font-size:14px}.loan-card-top small{display:block;color:var(--muted);font-size:11.5px;margin-top:3px}
.loan-card-amount{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.loan-card-amount small{color:var(--muted);font-size:11.5px}
.loan-bar{height:6px;border-radius:99px;background:var(--surface-2);overflow:hidden}.loan-bar span{display:block;height:100%;background:var(--green);border-radius:99px}
.loan-card-foot{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:11.5px;flex-wrap:wrap}
.loan-card-late{color:var(--neg);font-size:11.5px;font-weight:600}
.loan-detail{padding:16px;margin-bottom:14px}
.loan-detail-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.loan-detail-head h3{margin:0;font-size:16px}.loan-detail-head p{margin:5px 0 0;color:var(--muted);font-size:12.5px}
.loan-detail-actions{display:flex;gap:8px;flex-wrap:wrap}
.loan-figures{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;border-top:1px solid var(--line);padding-top:13px}
.loan-figures div{display:grid;gap:4px}.loan-figures span{color:var(--muted);font-size:11.5px}.loan-figures b{font-size:14px}
.loan-figures .pos{color:var(--green)}.loan-figures .neg{color:var(--neg)}
.loan-note{margin-top:12px;padding:10px 12px;border-radius:10px;background:var(--surface-2);color:var(--muted);font-size:12.5px}
.loan-tabs{margin-bottom:12px;width:max-content;max-width:100%;overflow:auto}
.loan-payments,.loan-forecast{padding:16px;margin-top:14px}
.loan-sub-head{margin-bottom:10px}.loan-sub-head h3{margin:0;font-size:15px}.loan-sub-head p{margin:5px 0 0;color:var(--muted);font-size:12.5px}
.bank-linked{color:var(--green);font-size:12.5px}.bank-linked small{color:var(--muted)}
.forecast-rows{display:grid;gap:10px}
.forecast-row{display:grid;grid-template-columns:64px minmax(0,1fr) 120px;grid-template-areas:'month bar amount' '. count count';align-items:center;gap:8px 10px}
.forecast-month{grid-area:month;font-size:12.5px;font-weight:600}
.forecast-bar{grid-area:bar;height:12px;border-radius:99px;background:var(--surface-2);overflow:hidden}
.forecast-bar span{display:block;height:100%;background:var(--green);border-radius:99px;min-width:2px}.forecast-bar span.late{background:var(--neg)}
.forecast-amount{grid-area:amount;text-align:left;font-size:13px;font-weight:600}
.forecast-count{grid-area:count;color:var(--muted);font-size:11.5px}
.schedule-preview{margin-top:14px;border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--surface-2)}
.schedule-preview-head{display:grid;gap:5px}.schedule-preview-head span{color:var(--muted);font-size:12px;line-height:1.7}
.schedule-regen{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12.5px;color:var(--neg)}
@media(max-width:1100px){.loan-figures{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:900px){.loan-kpis{grid-template-columns:repeat(2,1fr)}}
@media(max-width:580px){.loan-head{align-items:flex-start}.loan-kpis{grid-template-columns:1fr}.loan-figures{grid-template-columns:repeat(2,minmax(0,1fr))}.loan-detail-actions .btn{flex:1;justify-content:center}.forecast-row{grid-template-columns:56px minmax(0,1fr) 92px}}
`;
