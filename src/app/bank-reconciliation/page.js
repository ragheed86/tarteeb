'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getBankAccounts, createBankAccount, getBankTransactions, importBankTransactions, updateBankTransaction,
  getCompanyExpenses, createCompanyExpense, getReconciliationInvoicePayments,
} from '@/lib/data';
import { fmtMoney, fmtNum } from '@/lib/format';
import { Loading, Empty, ErrorBar, Modal, DataTable, Input, Select, Money, DateText, StatusPill, KpiCard } from '@/components';
import { toast } from '@/app/toast';

const STATUS = {
  unmatched: { label: 'غير مطابق', cls: 'p-wait' }, suggested: { label: 'مقترح', cls: 'p-prog' },
  matched: { label: 'مطابق', cls: 'p-done' }, excluded: { label: 'مستبعد', cls: 'p-cancel' },
};
const ACCOUNT_EMPTY = { name: '', bank_name: '', last_four: '', opening_balance: '0' };

function dateDistance(a, b) {
  return Math.abs(new Date(a).setHours(0, 0, 0, 0) - new Date(b).setHours(0, 0, 0, 0)) / 86400000;
}
function bestCandidate(tx, expenses, payments, matchedIds) {
  const outgoing = Number(tx.amount) < 0;
  const amount = Math.abs(Number(tx.amount));
  const candidates = outgoing
    ? expenses.map((x) => ({ kind: 'expense', id: x.id, date: x.expense_date, amount: Number(x.amount), label: x.description }))
    : payments.map((x) => ({ kind: 'payment', id: x.id, date: x.paid_at, amount: Number(x.amount), label: `دفعة فاتورة ${x.invoices?.number || '—'}` }));
  return candidates
    .filter((x) => !matchedIds.has(x.id) && Math.abs(x.amount - amount) < 0.01 && dateDistance(tx.transaction_date, x.date) <= 7)
    .map((x) => ({ ...x, confidence: Math.max(70, 100 - Math.round(dateDistance(tx.transaction_date, x.date) * 5)) }))
    .sort((a, b) => b.confidence - a.confidence)[0] || null;
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
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((x) => x.trim());
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
  return lines.slice(1).map((line, i) => {
    const cols = parseCsvLine(line, delimiter); const date = normalizeDate(cols[di]);
    const cleanNum = (v) => Number(String(v || '').replace(/,/g, '').replace(/\s/g, '')) || 0;
    const amount = ai >= 0 ? cleanNum(cols[ai]) : cleanNum(cols[credit]) - cleanNum(cols[debit]);
    const description = String(cols[dsi] || '').trim(); const reference = ri >= 0 ? String(cols[ri] || '').trim() : '';
    if (!date || !description || !amount) throw new Error(`بيانات غير صالحة في السطر ${i + 2}`);
    const external = ii >= 0 && cols[ii] ? String(cols[ii]).trim() : `${date}|${amount}|${reference}|${description}`;
    return { account_id: accountId, transaction_date: date, description, reference: reference || null, external_id: external, amount, import_batch: new Date().toISOString() };
  });
}

export default function BankReconciliationPage() {
  const fileRef = useRef(null);
  const [state, setState] = useState(null);
  const [accountId, setAccountId] = useState('');
  const [filter, setFilter] = useState('all');
  const [err, setErr] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountForm, setAccountForm] = useState(ACCOUNT_EMPTY);
  const [saving, setSaving] = useState(false);

  async function load(preferredAccount) {
    try {
      const accounts = await getBankAccounts();
      const chosen = preferredAccount || accountId || accounts[0]?.id || '';
      const [transactions, expenses, payments] = await Promise.all([
        chosen ? getBankTransactions(chosen) : Promise.resolve([]),
        getCompanyExpenses().catch(() => []), getReconciliationInvoicePayments().catch(() => []),
      ]);
      setAccountId(chosen); setState({ accounts, transactions, expenses, payments });
    } catch (e) { setErr(e.message || 'تعذّر تحميل المطابقة البنكية'); }
  }
  useEffect(() => { load(); }, []);
  async function changeAccount(id) { setAccountId(id); await load(id); }

  const matchedIds = useMemo(() => new Set((state?.transactions || []).flatMap((t) => [t.matched_expense_id, t.matched_invoice_payment_id]).filter(Boolean)), [state]);
  const rows = useMemo(() => (state?.transactions || []).map((tx) => ({ ...tx, suggestion: tx.status === 'unmatched' ? bestCandidate(tx, state.expenses, state.payments, matchedIds) : null })), [state, matchedIds]);
  const visible = rows.filter((r) => filter === 'all' || (filter === 'suggested' ? Boolean(r.suggestion) : r.status === filter));
  const matched = rows.filter((r) => r.status === 'matched').length;
  const pending = rows.filter((r) => r.status === 'unmatched').length;
  const suggested = rows.filter((r) => r.suggestion).length;
  const balance = (state?.accounts.find((a) => a.id === accountId)?.opening_balance || 0) + rows.reduce((s, r) => s + Number(r.amount || 0), 0);

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
  async function match(tx, candidate) {
    setSaving(true);
    try {
      await updateBankTransaction(tx.id, {
        status: 'matched', confidence: candidate.confidence,
        matched_expense_id: candidate.kind === 'expense' ? candidate.id : null,
        matched_invoice_payment_id: candidate.kind === 'payment' ? candidate.id : null,
      });
      toast('تم اعتماد المطابقة'); await load(accountId);
    } catch (e) { toast(e.message || 'تعذّر اعتماد المطابقة', 'err'); }
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
      toast('تم إنشاء المصروف ومطابقته'); await load(accountId);
    } catch (e) { toast(e.message || 'تعذّر إنشاء المصروف', 'err'); }
    finally { setSaving(false); }
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
          <div className="csv-hint">الأعمدة المدعومة: date, description, amount, reference — أو debit / credit</div>
        </div>
        <div className="kpis bank-kpis">
          <KpiCard label="الرصيد المحسوب" value={`${fmtMoney(balance)} ⃁`} trend={account?.bank_name || account?.name} definition="الرصيد الافتتاحي للحساب مضافًا إليه صافي جميع الحركات المستوردة." period="جميع حركات الحساب المحدد" formula="الرصيد الافتتاحي + الإيداعات − المسحوبات" breakdown={[{ label: 'الرصيد الافتتاحي', value: `${fmtMoney(account?.opening_balance || 0)} ⃁` }, { label: 'صافي الحركات', value: `${fmtMoney(rows.reduce((s, r) => s + Number(r.amount || 0), 0))} ⃁` }, { label: 'الرصيد المحسوب', value: `${fmtMoney(balance)} ⃁` }]} note="يجب أن يطابق الرصيد الختامي في كشف البنك بعد استيراد جميع الحركات." />
          <KpiCard tone="pos" label="حركات مطابقة" value={fmtNum(matched)} trend={`${rows.length ? fmtNum(Math.round(matched / rows.length * 100)) : '0'}% من الكشف`} definition="الحركات البنكية التي تم اعتماد ربطها بمصروف شركة أو دفعة فاتورة." period="كشف الحساب المحدد" formula="عدد الحركات المعتمدة ÷ إجمالي الحركات × 100" breakdown={[{ label: 'إجمالي الحركات', value: fmtNum(rows.length) }, { label: 'مطابقة', value: fmtNum(matched) }, { label: 'نسبة المطابقة', value: `${rows.length ? fmtNum(Math.round(matched / rows.length * 100)) : '0'}%` }]} />
          <KpiCard tone="alert" label="تحتاج مراجعة" value={fmtNum(pending)} trend={`${fmtNum(suggested)} اقتراح تلقائي`} definition="الحركات التي لم تُعتمد مطابقتها ولم تُستبعد بعد." period="كشف الحساب المحدد" formula="عدّ الحركات بالحالة «غير مطابق»" breakdown={[{ label: 'تحتاج مراجعة', value: fmtNum(pending) }, { label: 'لها اقتراح تلقائي', value: fmtNum(suggested) }, { label: 'بلا اقتراح', value: fmtNum(Math.max(pending - suggested, 0)) }]} />
        </div>
        <div className="viewtoggle bank-tabs">
          {[['all', 'الكل'], ['suggested', 'مقترحة'], ['unmatched', 'غير مطابقة'], ['matched', 'مطابقة'], ['excluded', 'مستبعدة']].map(([key, label]) => <button key={key} className={`vt${filter === key ? ' active' : ''}`} onClick={() => setFilter(key)}>{label}</button>)}
        </div>
        <div className="card" style={{ padding: '6px 0' }}>
          <DataTable rows={visible} empty={<Empty title="لا توجد حركات" desc="استورد كشف الحساب أو غيّر الفلتر." />} columns={[
            { key: 'description', label: 'الحركة', primary: true, render: (r) => <><span className="nm">{r.description}</span>{r.reference && <><br /><small dir="ltr">{r.reference}</small></>}</> },
            { key: 'transaction_date', label: 'التاريخ', render: (r) => <DateText v={r.transaction_date} /> },
            { key: 'amount', label: 'المبلغ', render: (r) => <Money v={r.amount} className={Number(r.amount) < 0 ? 'bank-out' : 'bank-in'} /> },
            { key: 'status', label: 'الحالة', render: (r) => <StatusPill status={r.suggestion ? 'suggested' : r.status} map={STATUS} /> },
            { key: 'suggestion', label: 'المطابقة', render: (r) => r.suggestion ? <div className="match-suggestion"><b>{r.suggestion.label}</b><small>ثقة {fmtNum(r.suggestion.confidence)}%</small></div> : r.status === 'matched' ? <span>تم الاعتماد</span> : '—' },
            { key: 'actions', label: 'إجراء', align: 'left', render: (r) => <div className="row-actions">{r.suggestion && <button className="btn sm" disabled={saving} onClick={() => match(r, r.suggestion)}>اعتماد</button>}{r.status === 'unmatched' && Number(r.amount) < 0 && !r.suggestion && <button className="btn ghost sm" disabled={saving} onClick={() => expenseFromTransaction(r)}>إنشاء مصروف</button>}{r.status === 'unmatched' && <button className="btn ghost sm" onClick={() => exclude(r)}>استبعاد</button>}{['matched', 'excluded'].includes(r.status) && <button className="btn ghost sm" onClick={() => undo(r)}>تراجع</button>}</div> },
          ]} />
        </div>
      </>}

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
.bank-head{margin-bottom:16px;align-items:flex-end}.bank-head h2{margin:0}.bank-head p{margin:5px 0 0;color:var(--muted);font-size:13px}.bank-actions,.row-actions{display:flex;gap:8px;flex-wrap:wrap}.bank-toolbar{display:flex;align-items:flex-end;gap:18px;margin-bottom:14px;padding:14px}.bank-toolbar .field{margin:0;min-width:250px}.csv-hint{color:var(--muted);font-size:12px;padding-bottom:10px}.bank-kpis{grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:14px}.bank-tabs{margin-bottom:12px;width:max-content;max-width:100%;overflow:auto}.bank-out{color:var(--neg)}.bank-in{color:var(--green)}.match-suggestion{display:flex;flex-direction:column;gap:3px}.match-suggestion small{color:var(--green)}.empty-action{text-align:center;padding-bottom:20px}
@media(max-width:850px){.bank-kpis{grid-template-columns:1fr}.bank-toolbar{align-items:stretch;flex-direction:column}.bank-toolbar .field{min-width:0}.bank-head{align-items:flex-start}}
`;
