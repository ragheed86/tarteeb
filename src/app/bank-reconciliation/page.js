'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getBankAccounts, createBankAccount, getBankTransactions, importBankTransactions, updateBankTransaction,
  getCompanyExpenses, createCompanyExpense, getReconciliationInvoicePayments,
  getReconciliationPeriods, closeReconciliationPeriod, reopenReconciliationPeriod, getBankTransactionAudit,
} from '@/lib/data';
import { fmtMoney, fmtNum } from '@/lib/format';
import { Loading, Empty, ErrorBar, Modal, DataTable, Input, Select, TextArea, Money, DateText, StatusPill, KpiCard } from '@/components';
import { toast } from '@/app/toast';

const STATUS = {
  unmatched: { label: 'غير مطابق', cls: 'p-wait' }, suggested: { label: 'مقترح', cls: 'p-prog' },
  matched: { label: 'مطابق', cls: 'p-done' }, excluded: { label: 'مستبعد', cls: 'p-cancel' },
};
const PERIOD_STATUS = { open: { label: 'مفتوح', cls: 'p-prog' }, closed: { label: 'مقفل', cls: 'p-done' } };
const AUDIT_ACTION = {
  import: 'استيراد', match: 'اعتماد اقتراح آلي', manual_match: 'مطابقة يدوية',
  exclude: 'استبعاد', reopen: 'إعادة للمراجعة', edit: 'تعديل',
};
const ACCOUNT_EMPTY = { name: '', bank_name: '', last_four: '', opening_balance: '0' };
const CLOSE_EMPTY = { statement_closing_balance: '', note: '' };

// معايير المطابقة التلقائية: فرق المبلغ المسموح، ونافذة التاريخ، وأدنى ثقة تُقترح.
const AMOUNT_TOLERANCE = 1;
const DATE_WINDOW = 14;
const MIN_CONFIDENCE = 60;
const MANUAL_LIMIT = 40;
// نافذة كشف التكرار داخل الكشف نفسه: نفس المبلغ ونفس الوصف خلال 3 أيام.
const DUPLICATE_WINDOW = 3;

function dateDistance(a, b) {
  return Math.abs(new Date(a).setHours(0, 0, 0, 0) - new Date(b).setHours(0, 0, 0, 0)) / 86400000;
}
function monthOf(date) { return `${String(date).slice(0, 7)}-01`; }
function monthLabel(month) {
  const [y, m] = String(month).split('-');
  return `${['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'][Number(m) - 1] || m} ${y}`;
}
// تطبيع المرجع: إسقاط الفواصل والمسافات وتوحيد الحالة حتى يُطابَق «INV-1024» مع «inv 1024».
function normalizeRef(value) {
  return String(value || '').replace(/[^0-9a-zA-Z؀-ۿ]/g, '').toUpperCase();
}
function candidatePool(kind, expenses, payments) {
  return kind === 'expense'
    ? expenses.map((x) => ({
      kind: 'expense', id: x.id, date: x.expense_date, amount: Number(x.amount), label: x.description,
      meta: [x.vendor, x.note].filter(Boolean).join(' · '),
      haystack: normalizeRef(`${x.description} ${x.vendor || ''} ${x.note || ''}`),
    }))
    : payments.map((x) => ({
      kind: 'payment', id: x.id, date: x.paid_at, amount: Number(x.amount), label: `دفعة فاتورة ${x.invoices?.number || '—'}`,
      meta: x.note || '',
      haystack: normalizeRef(`${x.invoices?.number || ''} ${x.note || ''}`),
    }));
}
function scoreCandidate(tx, candidate) {
  const amount = Math.abs(Number(tx.amount));
  const diff = Math.abs(candidate.amount - amount);
  if (diff > AMOUNT_TOLERANCE) return null;
  const days = dateDistance(tx.transaction_date, candidate.date);
  const ref = normalizeRef(tx.reference);
  const refHit = ref.length >= 4 && candidate.haystack.includes(ref);
  if (!refHit && days > DATE_WINDOW) return null;
  let confidence = 100 - Math.round(days * 3) - (diff < 0.01 ? 0 : 12);
  if (refHit) confidence = Math.max(confidence, 96);
  return { ...candidate, days, diff, refHit, confidence: Math.max(40, Math.min(100, confidence)) };
}
function bestCandidate(tx, expenses, payments, matchedIds) {
  const scored = candidatePool(Number(tx.amount) < 0 ? 'expense' : 'payment', expenses, payments)
    .filter((c) => !matchedIds.has(c.id))
    .map((c) => scoreCandidate(tx, c))
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence || a.days - b.days);
  const top = scored[0];
  if (!top || top.confidence < MIN_CONFIDENCE) return null;
  // مرشّحان بنفس الثقة = التباس؛ لا نقترح تلقائياً ونترك القرار للمطابقة اليدوية.
  if (scored[1] && scored[1].confidence === top.confidence) return null;
  return top;
}
function manualCandidates(tx, kind, expenses, payments, matchedIds, query) {
  const amount = Math.abs(Number(tx.amount));
  const q = query.trim().toLowerCase();
  return candidatePool(kind, expenses, payments)
    .filter((c) => !matchedIds.has(c.id))
    .filter((c) => !q || `${c.label} ${c.meta} ${c.amount}`.toLowerCase().includes(q))
    .map((c) => ({ ...c, diff: c.amount - amount, days: dateDistance(tx.transaction_date, c.date) }))
    .sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff) || a.days - b.days)
    .slice(0, MANUAL_LIMIT);
}

function parseCsvLine(line, delimiter) {
  const out = []; let value = ''; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && quoted && line[i + 1] === '"') { value += '"'; i += 1; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) { out.push(value.trim()); value = ''; }
    else value += ch;
  }
  out.push(value.trim()); return out;
}
function normalizeDate(value) {
  const v = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = v.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}
function parseCsv(text, accountId) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((x) => x.trim());
  if (lines.length < 2) throw new Error('الملف لا يحتوي على حركات');
  const delimiter = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const headers = parseCsvLine(lines[0], delimiter).map((h) => h.trim().toLowerCase());
  const names = {
    date: ['date', 'transaction_date', 'تاريخ', 'التاريخ'], description: ['description', 'details', 'بيان', 'الوصف', 'التفاصيل'],
    amount: ['amount', 'المبلغ'], debit: ['debit', 'مدين', 'خصم'], credit: ['credit', 'دائن', 'إيداع'],
    reference: ['reference', 'ref', 'المرجع', 'رقم المرجع'], id: ['id', 'transaction_id', 'رقم العملية'],
  };
  const idx = (key) => headers.findIndex((h) => names[key].includes(h));
  const di = idx('date'), dsi = idx('description'), ai = idx('amount'), debit = idx('debit'), credit = idx('credit'), ri = idx('reference'), ii = idx('id');
  if (di < 0 || dsi < 0 || (ai < 0 && debit < 0 && credit < 0)) throw new Error('يلزم وجود أعمدة التاريخ والوصف والمبلغ (أو مدين/دائن)');
  // عدّاد التكرار داخل الملف: حركتان حقيقيتان متطابقتان بنفس اليوم تأخذان معرّفين مختلفين
  // فلا تُبتلع إحداهما كأنها نسخة مكررة، مع إبقاء أول ظهور بالمعرّف القديم حفاظاً على الاستيرادات السابقة.
  const seen = new Map();
  const batch = new Date().toISOString();
  return lines.slice(1).map((line, i) => {
    const cols = parseCsvLine(line, delimiter); const date = normalizeDate(cols[di]);
    const cleanNum = (v) => Number(String(v || '').replace(/,/g, '').replace(/\s/g, '')) || 0;
    const amount = ai >= 0 ? cleanNum(cols[ai]) : cleanNum(cols[credit]) - cleanNum(cols[debit]);
    const description = String(cols[dsi] || '').trim(); const reference = ri >= 0 ? String(cols[ri] || '').trim() : '';
    if (!date || !description || !amount) throw new Error(`بيانات غير صالحة في السطر ${i + 2}`);
    let external = ii >= 0 && cols[ii] ? String(cols[ii]).trim() : `${date}|${amount}|${reference}|${description}`;
    if (!(ii >= 0 && cols[ii])) {
      const occurrence = (seen.get(external) || 0) + 1; seen.set(external, occurrence);
      if (occurrence > 1) external = `${external}#${occurrence}`;
    }
    return { account_id: accountId, transaction_date: date, description, reference: reference || null, external_id: external, amount, import_batch: batch };
  });
}

function matchError(e) {
  const message = e?.message || '';
  if (e?.code === '23505' || /duplicate key|unique/i.test(message)) return 'هذا البند مرتبط بحركة بنكية أخرى مسبقاً';
  return message || 'تعذّر اعتماد المطابقة';
}

// تكرار محتمل داخل الكشف: حركتان بنفس المبلغ ونفس الوصف خلال نافذة قصيرة.
// لا نحذف شيئاً — نرفع راية للمراجع لأن التكرار قد يكون حقيقياً (شحنتان بنفس السعر).
function findDuplicates(transactions) {
  const groups = new Map();
  transactions.forEach((t) => {
    const key = `${Math.abs(Number(t.amount))}|${normalizeRef(t.description)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });
  const flagged = new Set();
  groups.forEach((list) => {
    if (list.length < 2) return;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (dateDistance(list[i].transaction_date, list[j].transaction_date) <= DUPLICATE_WINDOW) {
          flagged.add(list[i].id); flagged.add(list[j].id);
        }
      }
    }
  });
  return flagged;
}

function csvCell(value) {
  const v = value == null ? '' : String(value);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
function downloadCsv(rows, filename) {
  // BOM حتى يفتح Excel العربية بترميز صحيح.
  const blob = new Blob([`﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export default function BankReconciliationPage() {
  const fileRef = useRef(null);
  const [state, setState] = useState(null);
  const [accountId, setAccountId] = useState('');
  const [filter, setFilter] = useState('all');
  const [err, setErr] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountForm, setAccountForm] = useState(ACCOUNT_EMPTY);
  const [manual, setManual] = useState(null);
  const [manualKind, setManualKind] = useState('expense');
  const [manualQuery, setManualQuery] = useState('');
  const [closeMonth, setCloseMonth] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeForm, setCloseForm] = useState(CLOSE_EMPTY);
  const [audit, setAudit] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load(preferredAccount) {
    try {
      const accounts = await getBankAccounts();
      const chosen = preferredAccount || accountId || accounts[0]?.id || '';
      const [transactions, expenses, payments, periods] = await Promise.all([
        chosen ? getBankTransactions(chosen) : Promise.resolve([]),
        getCompanyExpenses().catch(() => []), getReconciliationInvoicePayments().catch(() => []),
        chosen ? getReconciliationPeriods(chosen).catch(() => []) : Promise.resolve([]),
      ]);
      setAccountId(chosen); setState({ accounts, transactions, expenses, payments, periods });
    } catch (e) { setErr(e.message || 'تعذّر تحميل المطابقة البنكية'); }
  }
  useEffect(() => { load(); }, []);
  async function changeAccount(id) { setAccountId(id); setCloseMonth(''); await load(id); }

  const matchedIds = useMemo(() => new Set((state?.transactions || []).flatMap((t) => [t.matched_expense_id, t.matched_invoice_payment_id]).filter(Boolean)), [state]);
  const expenseById = useMemo(() => new Map((state?.expenses || []).map((x) => [x.id, x])), [state]);
  const paymentById = useMemo(() => new Map((state?.payments || []).map((x) => [x.id, x])), [state]);
  const periodByMonth = useMemo(() => new Map((state?.periods || []).map((p) => [p.month, p])), [state]);
  const closedMonths = useMemo(() => new Set((state?.periods || []).filter((p) => p.status === 'closed').map((p) => p.month)), [state]);
  const duplicateIds = useMemo(() => findDuplicates(state?.transactions || []), [state]);
  const rows = useMemo(() => (state?.transactions || []).map((tx) => {
    const locked = closedMonths.has(monthOf(tx.transaction_date));
    return {
      ...tx,
      locked,
      duplicate: duplicateIds.has(tx.id),
      suggestion: !locked && tx.status === 'unmatched' ? bestCandidate(tx, state.expenses, state.payments, matchedIds) : null,
    };
  }), [state, matchedIds, closedMonths, duplicateIds]);
  const visible = rows.filter((r) => filter === 'all' || (filter === 'suggested' ? Boolean(r.suggestion) : r.status === filter));
  const matched = rows.filter((r) => r.status === 'matched').length;
  const pending = rows.filter((r) => r.status === 'unmatched').length;
  const suggested = rows.filter((r) => r.suggestion).length;
  const balance = (state?.accounts.find((a) => a.id === accountId)?.opening_balance || 0) + rows.reduce((s, r) => s + Number(r.amount || 0), 0);

  const months = useMemo(() => [...new Set(rows.map((r) => monthOf(r.transaction_date)))].sort().reverse(), [rows]);
  const activeMonth = closeMonth && months.includes(closeMonth) ? closeMonth : months[0] || '';
  const monthRows = rows.filter((r) => monthOf(r.transaction_date) === activeMonth);
  const monthPending = monthRows.filter((r) => r.status === 'unmatched').length;
  const openingBalance = Number(state?.accounts.find((a) => a.id === accountId)?.opening_balance || 0);
  // الرصيد المحسوب حتى نهاية الشهر المختار — نفس ما تثبّته دالة الإقفال في القاعدة.
  const monthBalance = openingBalance + rows.filter((r) => monthOf(r.transaction_date) <= activeMonth).reduce((s, r) => s + Number(r.amount || 0), 0);
  const activePeriod = periodByMonth.get(activeMonth);
  const periodClosed = activePeriod?.status === 'closed';
  const monthDuplicates = monthRows.filter((r) => r.duplicate).length;
  const statementInput = closeForm.statement_closing_balance === '' ? null : Number(closeForm.statement_closing_balance);
  const liveGap = statementInput == null ? null : statementInput - monthBalance;
  const closedGap = activePeriod?.statement_closing_balance == null ? null
    : Number(activePeriod.statement_closing_balance) - Number(activePeriod.computed_balance);

  function matchedLabel(r) {
    if (r.matched_expense_id) return expenseById.get(r.matched_expense_id)?.description || 'مصروف مرتبط';
    if (r.matched_invoice_payment_id) {
      const p = paymentById.get(r.matched_invoice_payment_id);
      return p ? `دفعة فاتورة ${p.invoices?.number || '—'}` : 'دفعة مرتبطة';
    }
    return null;
  }
  function openManual(tx) {
    setManual(tx); setManualKind(Number(tx.amount) < 0 ? 'expense' : 'payment'); setManualQuery('');
  }
  const manualList = useMemo(
    () => (manual && state ? manualCandidates(manual, manualKind, state.expenses, state.payments, matchedIds, manualQuery) : []),
    [manual, manualKind, state, matchedIds, manualQuery],
  );
  async function openAudit(tx) {
    setAudit({ tx, rows: null });
    try { setAudit({ tx, rows: await getBankTransactionAudit(tx.id) }); }
    catch (e) { setAudit(null); toast(e.message || 'تعذّر تحميل السجل', 'err'); }
  }

  async function addAccount(e) {
    e.preventDefault(); if (!accountForm.name.trim()) return;
    setSaving(true);
    try {
      const created = await createBankAccount({ name: accountForm.name.trim(), bank_name: accountForm.bank_name.trim() || null, last_four: accountForm.last_four || null, opening_balance: Number(accountForm.opening_balance) || 0 });
      setAccountOpen(false); setAccountForm(ACCOUNT_EMPTY); toast('تمت إضافة الحساب'); await load(created.id);
    } catch (e2) { toast(e2.message || 'تعذّرت إضافة الحساب', 'err'); }
    finally { setSaving(false); }
  }
  async function importFile(e) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file || !accountId) return;
    setSaving(true);
    try {
      const parsed = parseCsv(await file.text(), accountId); const inserted = await importBankTransactions(parsed);
      toast(`تم استيراد ${fmtNum(inserted.length)} حركة جديدة`); await load(accountId);
    } catch (e2) { toast(e2.message || 'تعذّر استيراد الملف', 'err'); }
    finally { setSaving(false); }
  }
  // confidence = null تعني مطابقة يدوية اعتمدها المستخدم بنفسه، تمييزاً عن ثقة الخوارزمية.
  async function match(tx, candidate, manualMatch) {
    setSaving(true);
    try {
      await updateBankTransaction(tx.id, {
        status: 'matched', confidence: manualMatch ? null : candidate.confidence,
        matched_expense_id: candidate.kind === 'expense' ? candidate.id : null,
        matched_invoice_payment_id: candidate.kind === 'payment' ? candidate.id : null,
      });
      setManual(null); toast(manualMatch ? 'تمت المطابقة اليدوية' : 'تم اعتماد المطابقة'); await load(accountId);
    } catch (e) { toast(matchError(e), 'err'); }
    finally { setSaving(false); }
  }
  async function exclude(tx) {
    try { await updateBankTransaction(tx.id, { status: 'excluded', confidence: null, matched_expense_id: null, matched_invoice_payment_id: null }); toast('تم استبعاد الحركة'); await load(accountId); }
    catch (e) { toast(e.message || 'تعذّر الاستبعاد', 'err'); }
  }
  async function undo(tx) {
    try { await updateBankTransaction(tx.id, { status: 'unmatched', confidence: null, matched_expense_id: null, matched_invoice_payment_id: null }); toast('أُعيدت الحركة للمراجعة'); await load(accountId); }
    catch (e) { toast(e.message || 'تعذّر التراجع', 'err'); }
  }
  async function expenseFromTransaction(tx) {
    if (Number(tx.amount) >= 0) return;
    setSaving(true);
    try {
      const expense = await createCompanyExpense({ description: tx.description, category: 'other', amount: Math.abs(Number(tx.amount)), vat_amount: 0, expense_date: tx.transaction_date, payment_status: 'paid', recurrence: 'none', note: tx.reference ? `مرجع البنك: ${tx.reference}` : null });
      await updateBankTransaction(tx.id, { status: 'matched', matched_expense_id: expense.id, matched_invoice_payment_id: null, confidence: 100 });
      setManual(null); toast('تم إنشاء المصروف ومطابقته'); await load(accountId);
    } catch (e) { toast(e.message || 'تعذّر إنشاء المصروف', 'err'); }
    finally { setSaving(false); }
  }
  async function submitClose(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await closeReconciliationPeriod(accountId, activeMonth, statementInput, closeForm.note.trim() || null);
      setCloseOpen(false); setCloseForm(CLOSE_EMPTY); toast(`تم إقفال ${monthLabel(activeMonth)}`); await load(accountId);
    } catch (e2) { toast(e2.message || 'تعذّر الإقفال', 'err'); }
    finally { setSaving(false); }
  }
  async function reopen() {
    setSaving(true);
    try { await reopenReconciliationPeriod(accountId, activeMonth); toast(`أُعيد فتح ${monthLabel(activeMonth)}`); await load(accountId); }
    catch (e) { toast(e.message || 'تعذّرت إعادة الفتح', 'err'); }
    finally { setSaving(false); }
  }
  // تقرير ما قبل الإقفال: كل حركات الشهر بحالتها ومصدرها، مع رايات التكرار والفروقات.
  function exportMonthReport() {
    const header = ['التاريخ', 'الوصف', 'المرجع', 'المبلغ', 'الحالة', 'البند المطابق', 'نوع المطابقة', 'تكرار محتمل'];
    const body = monthRows.map((r) => [
      r.transaction_date, r.description, r.reference || '', r.amount,
      STATUS[r.status]?.label || r.status,
      matchedLabel(r) || '',
      r.status === 'matched' ? (r.confidence == null ? 'يدوية' : `آلية ${r.confidence}%`) : '',
      r.duplicate ? 'نعم' : '',
    ]);
    const summary = [
      [],
      ['إجمالي حركات الشهر', monthRows.length],
      ['غير مطابقة', monthPending],
      ['تكرارات محتملة', monthDuplicates],
      ['الرصيد المحسوب حتى نهاية الشهر', monthBalance],
    ];
    if (activePeriod?.statement_closing_balance != null) {
      summary.push(['الرصيد الختامي في كشف البنك', Number(activePeriod.statement_closing_balance)]);
      summary.push(['الفرق', closedGap]);
    }
    downloadCsv([header, ...body, ...summary], `مطابقة-${activeMonth.slice(0, 7)}.csv`);
  }

  if (err) return <ErrorBar message={err} />;
  if (!state) return <Loading />;
  const account = state.accounts.find((a) => a.id === accountId);

  return (
    <>
      <style>{CSS}</style>
      <div className="sec-head bank-head">
        <div><h2>المطابقة البنكية</h2><p>استورد كشف الحساب ثم راجع المطابقات المقترحة</p></div>
        <div className="bank-actions"><button className="btn ghost" onClick={() => setAccountOpen(true)}>+ حساب بنكي</button><button className="btn" disabled={!accountId || saving} onClick={() => fileRef.current?.click()}>استيراد CSV</button><input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={importFile} /></div>
      </div>

      {state.accounts.length === 0 ? <div className="card"><Empty title="لا يوجد حساب بنكي" desc="أضف الحساب أولاً، ثم استورد كشف CSV." /><div className="empty-action"><button className="btn" onClick={() => setAccountOpen(true)}>إضافة حساب بنكي</button></div></div> : <>
        <div className="card bank-toolbar">
          <Select label="الحساب" value={accountId} onChange={(e) => changeAccount(e.target.value)} options={state.accounts.map((a) => ({ value: a.id, label: `${a.name}${a.last_four ? ` • ${a.last_four}` : ''}` }))} />
          <div className="csv-hint">الأعمدة المدعومة: date, description, amount, reference — أو debit / credit<br />المطابقة التلقائية تقارن المبلغ (±{fmtNum(AMOUNT_TOLERANCE)}) والتاريخ (±{fmtNum(DATE_WINDOW)} يوم) والمرجع.</div>
        </div>

        {months.length > 0 && <div className="card close-bar">
          <Select label="شهر الإقفال" value={activeMonth} onChange={(e) => setCloseMonth(e.target.value)} options={months.map((m) => ({ value: m, label: `${monthLabel(m)}${closedMonths.has(m) ? ' — مقفل' : ''}` }))} />
          <div className="close-stats">
            <div><span>حركات الشهر</span><b>{fmtNum(monthRows.length)}</b></div>
            <div><span>غير مطابقة</span><b className={monthPending ? 'bank-out' : 'bank-in'}>{fmtNum(monthPending)}</b></div>
            <div><span>تكرارات محتملة</span><b className={monthDuplicates ? 'bank-out' : 'bank-in'}>{fmtNum(monthDuplicates)}</b></div>
            <div><span>الرصيد حتى نهاية الشهر</span><b>{fmtMoney(monthBalance)} ⃁</b></div>
            {periodClosed && closedGap != null && <div><span>فرق الكشف</span><b className={Math.abs(closedGap) < 0.01 ? 'bank-in' : 'bank-out'}>{fmtMoney(closedGap)} ⃁</b></div>}
          </div>
          <div className="close-cta">
            <StatusPill status={periodClosed ? 'closed' : 'open'} map={PERIOD_STATUS} />
            <button className="btn ghost sm" onClick={exportMonthReport}>تقرير الشهر</button>
            {periodClosed
              ? <button className="btn ghost sm" disabled={saving} onClick={reopen}>إعادة فتح الشهر</button>
              : <button className="btn sm" disabled={saving || monthPending > 0} onClick={() => { setCloseForm(CLOSE_EMPTY); setCloseOpen(true); }}>إقفال الشهر</button>}
          </div>
          {!periodClosed && monthPending > 0 && <p className="close-block">يتبقى {fmtNum(monthPending)} حركة غير مطابقة — طابقها أو استبعدها قبل الإقفال.</p>}
          {periodClosed && <p className="close-block closed-note">حركات هذا الشهر مقفلة للتعديل. {activePeriod?.note}</p>}
        </div>}

        <div className="kpis bank-kpis">
          <KpiCard label="الرصيد المحسوب" value={`${fmtMoney(balance)} ⃁`} trend={account?.bank_name || account?.name} definition="الرصيد الافتتاحي للحساب مضافًا إليه صافي جميع الحركات المستوردة." period="جميع حركات الحساب المحدد" formula="الرصيد الافتتاحي + الإيداعات − المسحوبات" breakdown={[{ label: 'الرصيد الافتتاحي', value: `${fmtMoney(openingBalance)} ⃁` }, { label: 'صافي الحركات', value: `${fmtMoney(rows.reduce((s, r) => s + Number(r.amount || 0), 0))} ⃁` }, { label: 'الرصيد المحسوب', value: `${fmtMoney(balance)} ⃁` }]} note="يجب أن يطابق الرصيد الختامي في كشف البنك بعد استيراد جميع الحركات." />
          <KpiCard tone="pos" label="حركات مطابقة" value={fmtNum(matched)} trend={`${rows.length ? fmtNum(Math.round(matched / rows.length * 100)) : '0'}% من الكشف`} definition="الحركات البنكية التي تم اعتماد ربطها بمصروف شركة أو دفعة فاتورة." period="كشف الحساب المحدد" formula="عدد الحركات المعتمدة ÷ إجمالي الحركات × 100" breakdown={[{ label: 'إجمالي الحركات', value: fmtNum(rows.length) }, { label: 'مطابقة', value: fmtNum(matched) }, { label: 'نسبة المطابقة', value: `${rows.length ? fmtNum(Math.round(matched / rows.length * 100)) : '0'}%` }]} />
          <KpiCard tone="alert" label="تحتاج مراجعة" value={fmtNum(pending)} trend={`${fmtNum(suggested)} اقتراح تلقائي`} definition="الحركات التي لم تُعتمد مطابقتها ولم تُستبعد بعد." period="كشف الحساب المحدد" formula="عدّ الحركات بالحالة «غير مطابق»" breakdown={[{ label: 'تحتاج مراجعة', value: fmtNum(pending) }, { label: 'لها اقتراح تلقائي', value: fmtNum(suggested) }, { label: 'بلا اقتراح', value: fmtNum(Math.max(pending - suggested, 0)) }]} />
        </div>
        <div className="viewtoggle bank-tabs">
          {[['all', 'الكل'], ['suggested', 'مقترحة'], ['unmatched', 'غير مطابقة'], ['matched', 'مطابقة'], ['excluded', 'مستبعدة']].map(([key, label]) => <button key={key} className={`vt${filter === key ? ' active' : ''}`} onClick={() => setFilter(key)}>{label}</button>)}
        </div>
        <div className="card" style={{ padding: '6px 0' }}>
          <DataTable rows={visible} empty={<Empty title="لا توجد حركات" desc="استورد كشف الحساب أو غيّر الفلتر." />} columns={[
            { key: 'description', label: 'الحركة', primary: true, render: (r) => <><span className="nm">{r.description}</span>{r.duplicate && <span className="dup-flag">تكرار محتمل</span>}{r.reference && <><br /><small dir="ltr">{r.reference}</small></>}</> },
            { key: 'transaction_date', label: 'التاريخ', render: (r) => <DateText v={r.transaction_date} /> },
            { key: 'amount', label: 'المبلغ', render: (r) => <Money v={r.amount} className={Number(r.amount) < 0 ? 'bank-out' : 'bank-in'} /> },
            { key: 'status', label: 'الحالة', render: (r) => <StatusPill status={r.suggestion ? 'suggested' : r.status} map={STATUS} /> },
            {
              key: 'suggestion',
              label: 'المطابقة',
              render: (r) => {
                if (r.suggestion) {
                  return <div className="match-suggestion"><b>{r.suggestion.label}</b><small>{r.suggestion.refHit ? 'تطابق المرجع' : `ثقة ${fmtNum(r.suggestion.confidence)}%`}</small></div>;
                }
                if (r.status === 'matched') {
                  return <div className="match-suggestion"><b>{matchedLabel(r) || 'تم الاعتماد'}</b><small className="match-note">{r.confidence == null ? 'مطابقة يدوية' : `ثقة ${fmtNum(r.confidence)}%`}</small></div>;
                }
                return '—';
              },
            },
            {
              key: 'actions',
              label: 'إجراء',
              align: 'left',
              render: (r) => (
                <div className="row-actions">
                  {r.locked
                    ? <span className="lock-note">الشهر مقفل</span>
                    : <>
                      {r.suggestion && <button className="btn sm" disabled={saving} onClick={() => match(r, r.suggestion)}>اعتماد</button>}
                      {r.status === 'unmatched' && <button className="btn ghost sm" disabled={saving} onClick={() => openManual(r)}>طابق يدوياً</button>}
                      {r.status === 'unmatched' && Number(r.amount) < 0 && !r.suggestion && <button className="btn ghost sm" disabled={saving} onClick={() => expenseFromTransaction(r)}>إنشاء مصروف</button>}
                      {r.status === 'unmatched' && <button className="btn ghost sm" onClick={() => exclude(r)}>استبعاد</button>}
                      {['matched', 'excluded'].includes(r.status) && <button className="btn ghost sm" onClick={() => undo(r)}>تراجع</button>}
                    </>}
                  <button className="btn ghost sm" onClick={() => openAudit(r)}>السجل</button>
                </div>
              ),
            },
          ]} />
        </div>
      </>}

      <Modal open={Boolean(manual)} onClose={() => !saving && setManual(null)} title="مطابقة يدوية" subtitle="اختر البند الذي تمثّله هذه الحركة البنكية" size="lg" footer={<><button type="button" className="btn ghost" onClick={() => setManual(null)}>إغلاق</button>{manual && Number(manual.amount) < 0 && <button type="button" className="btn" disabled={saving} onClick={() => expenseFromTransaction(manual)}>إنشاء مصروف جديد بدلاً من ذلك</button>}</>}>
        {manual && <>
          <div className="manual-tx">
            <div><span className="manual-lbl">الحركة</span><b>{manual.description}</b></div>
            <div><span className="manual-lbl">التاريخ</span><DateText v={manual.transaction_date} /></div>
            <div><span className="manual-lbl">المبلغ</span><Money v={manual.amount} className={Number(manual.amount) < 0 ? 'bank-out' : 'bank-in'} /></div>
            {manual.reference && <div><span className="manual-lbl">المرجع</span><small dir="ltr">{manual.reference}</small></div>}
          </div>
          <div className="manual-filters">
            <Select label="نوع البند" value={manualKind} onChange={(e) => setManualKind(e.target.value)} options={[{ value: 'expense', label: 'مصروف شركة' }, { value: 'payment', label: 'دفعة فاتورة' }]} />
            <Input label="بحث" value={manualQuery} onChange={(e) => setManualQuery(e.target.value)} placeholder="وصف، مورّد، رقم فاتورة أو مبلغ" />
          </div>
          {manualList.length === 0
            ? <Empty title="لا توجد بنود مطابقة" desc="غيّر نوع البند أو كلمة البحث، أو أنشئ مصروفاً جديداً." />
            : <ul className="cand-list">
              {manualList.map((c) => (
                <li key={`${c.kind}-${c.id}`}>
                  <button type="button" className="cand" disabled={saving} onClick={() => match(manual, c, true)}>
                    <span className="cand-main"><b>{c.label}</b>{c.meta && <small>{c.meta}</small>}</span>
                    <span className="cand-side">
                      <Money v={c.amount} />
                      <small className={Math.abs(c.diff) < 0.01 ? 'cand-ok' : 'cand-diff'}>
                        {Math.abs(c.diff) < 0.01 ? 'مبلغ مطابق' : `فرق ${fmtMoney(Math.abs(c.diff))} ⃁`} · {c.days === 0 ? 'نفس اليوم' : `${fmtNum(c.days)} يوم`}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>}
          {manualList.length === MANUAL_LIMIT && <p className="cand-more">تُعرض أقرب {fmtNum(MANUAL_LIMIT)} نتيجة — استخدم البحث لتضييق القائمة.</p>}
        </>}
      </Modal>

      <Modal open={closeOpen} onClose={() => !saving && setCloseOpen(false)} title={`إقفال ${activeMonth ? monthLabel(activeMonth) : ''}`} subtitle="يُثبَّت الرصيد المحسوب وتُقفل حركات الشهر للتعديل" as="form" onSubmit={submitClose} size="sm" footer={<><button type="button" className="btn ghost" onClick={() => setCloseOpen(false)}>إلغاء</button><button className="btn" disabled={saving}>إقفال الشهر</button></>}>
        <div className="manual-tx">
          <div><span className="manual-lbl">حركات الشهر</span><b>{fmtNum(monthRows.length)}</b></div>
          <div><span className="manual-lbl">الرصيد المحسوب</span><b>{fmtMoney(monthBalance)} ⃁</b></div>
        </div>
        <Input label="الرصيد الختامي في كشف البنك (اختياري)" type="number" step="0.01" ltr value={closeForm.statement_closing_balance} onChange={(e) => setCloseForm((f) => ({ ...f, statement_closing_balance: e.target.value }))} hint="أدخله ليُحفظ الفرق مع الإقفال" />
        {liveGap != null && <p className={`gap-note ${Math.abs(liveGap) < 0.01 ? 'gap-ok' : 'gap-bad'}`}>{Math.abs(liveGap) < 0.01 ? 'الرصيدان متطابقان' : `فرق ${fmtMoney(Math.abs(liveGap))} ⃁ بين كشف البنك والرصيد المحسوب`}</p>}
        <TextArea label="ملاحظة الإقفال" rows="2" value={closeForm.note} onChange={(e) => setCloseForm((f) => ({ ...f, note: e.target.value }))} />
      </Modal>

      <Modal open={Boolean(audit)} onClose={() => setAudit(null)} title="سجل المراجعة" subtitle={audit?.tx?.description} size="md" footer={<button type="button" className="btn ghost" onClick={() => setAudit(null)}>إغلاق</button>}>
        {audit?.rows == null ? <Loading /> : audit.rows.length === 0
          ? <Empty title="لا يوجد سجل" desc="السجل يبدأ من أول تغيير بعد تفعيل الإقفال الشهري." />
          : <ul className="audit-list">
            {audit.rows.map((a) => (
              <li key={a.id}>
                <b>{AUDIT_ACTION[a.action] || a.action}</b>
                <small>{a.old_status ? `${STATUS[a.old_status]?.label || a.old_status} ← ${STATUS[a.new_status]?.label || a.new_status}` : STATUS[a.new_status]?.label || a.new_status}</small>
                <small className="audit-time" dir="ltr">{new Date(a.created_at).toLocaleString('en-GB')}</small>
              </li>
            ))}
          </ul>}
      </Modal>

      <Modal open={accountOpen} onClose={() => !saving && setAccountOpen(false)} title="حساب بنكي جديد" subtitle="لا تُخزّن بيانات الدخول أو رقم الحساب الكامل" as="form" onSubmit={addAccount} size="sm" footer={<><button type="button" className="btn ghost" onClick={() => setAccountOpen(false)}>إلغاء</button><button className="btn" disabled={saving}>حفظ الحساب</button></>}>
        <Input label="اسم مختصر للحساب" value={accountForm.name} onChange={(e) => setAccountForm((f) => ({ ...f, name: e.target.value }))} placeholder="الحساب التشغيلي" required />
        <Input label="اسم البنك" value={accountForm.bank_name} onChange={(e) => setAccountForm((f) => ({ ...f, bank_name: e.target.value }))} />
        <Input label="آخر 4 أرقام" ltr maxLength="4" pattern="[0-9]{4}" value={accountForm.last_four} onChange={(e) => setAccountForm((f) => ({ ...f, last_four: e.target.value.replace(/\D/g, '').slice(0, 4) }))} />
        <Input label="الرصيد الافتتاحي" type="number" step="0.01" ltr value={accountForm.opening_balance} onChange={(e) => setAccountForm((f) => ({ ...f, opening_balance: e.target.value }))} />
      </Modal>
    </>
  );
}

const CSS = `
.bank-head{margin-bottom:16px;align-items:flex-end}.bank-head h2{margin:0}.bank-head p{margin:5px 0 0;color:var(--muted);font-size:13px}.bank-actions,.row-actions{display:flex;gap:8px;flex-wrap:wrap}.bank-toolbar{display:flex;align-items:flex-end;gap:18px;margin-bottom:14px;padding:14px}.bank-toolbar .field{margin:0;min-width:250px}.csv-hint{color:var(--muted);font-size:12px;padding-bottom:10px;line-height:1.7}.bank-kpis{grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:14px}.bank-tabs{margin-bottom:12px;width:max-content;max-width:100%;overflow:auto}.bank-out{color:var(--neg)}.bank-in{color:var(--green)}.match-suggestion{display:flex;flex-direction:column;gap:3px}.match-suggestion small{color:var(--green)}.match-suggestion .match-note{color:var(--muted)}.empty-action{text-align:center;padding-bottom:20px}.lock-note{color:var(--muted);font-size:12px;align-self:center}
.close-bar{display:flex;align-items:flex-end;gap:18px;flex-wrap:wrap;padding:14px;margin-bottom:14px}.close-bar .field{margin:0;min-width:210px}.close-stats{display:flex;gap:22px;flex-wrap:wrap;padding-bottom:6px}.close-stats>div{display:flex;flex-direction:column;gap:2px}.close-stats span{color:var(--muted);font-size:11px}.close-cta{display:flex;align-items:center;gap:10px;margin-inline-start:auto;padding-bottom:4px}.close-block{flex-basis:100%;margin:2px 0 0;color:var(--neg);font-size:12px}.close-block.closed-note{color:var(--muted)}
.manual-tx{display:flex;flex-wrap:wrap;gap:8px 22px;padding:12px 14px;margin-bottom:14px;border:1px solid var(--line);border-radius:10px;background:var(--bg-soft,transparent)}.manual-tx>div{display:flex;flex-direction:column;gap:2px}.manual-lbl{color:var(--muted);font-size:11px}.manual-filters{display:flex;gap:14px;flex-wrap:wrap}.manual-filters .field{flex:1;min-width:200px}
.cand-list{list-style:none;margin:6px 0 0;padding:0;max-height:46vh;overflow:auto;border:1px solid var(--line);border-radius:10px}.cand-list li+li{border-top:1px solid var(--line)}.cand{display:flex;justify-content:space-between;align-items:center;gap:14px;width:100%;padding:11px 13px;background:none;border:0;cursor:pointer;text-align:start;font:inherit;color:inherit}.cand:hover:not(:disabled){background:var(--hover,rgba(0,0,0,.04))}.cand:disabled{opacity:.6;cursor:default}.cand-main,.cand-side{display:flex;flex-direction:column;gap:3px}.cand-side{align-items:flex-end;text-align:end;white-space:nowrap}.cand-main small{color:var(--muted);font-size:12px}.cand-ok{color:var(--green);font-size:11px}.cand-diff{color:var(--muted);font-size:11px}.cand-more{color:var(--muted);font-size:12px;margin:8px 0 0}
.gap-note{margin:2px 0 10px;font-size:12px}.gap-ok{color:var(--green)}.gap-bad{color:var(--neg)}.dup-flag{display:inline-block;margin-inline-start:7px;padding:1px 7px;border-radius:999px;font-size:11px;color:var(--neg);border:1px solid var(--neg)}
.audit-list{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:10px;max-height:50vh;overflow:auto}.audit-list li{display:flex;flex-direction:column;gap:3px;padding:10px 13px}.audit-list li+li{border-top:1px solid var(--line)}.audit-list small{color:var(--muted);font-size:12px}.audit-list .audit-time{font-size:11px}
@media(max-width:850px){.bank-kpis{grid-template-columns:1fr}.bank-toolbar{align-items:stretch;flex-direction:column}.bank-toolbar .field{min-width:0}.bank-head{align-items:flex-start}.close-bar{align-items:stretch;flex-direction:column}.close-bar .field{min-width:0}.close-cta{margin-inline-start:0}.cand{flex-direction:column;align-items:flex-start;gap:6px}.cand-side{align-items:flex-start;text-align:start}}
`;
