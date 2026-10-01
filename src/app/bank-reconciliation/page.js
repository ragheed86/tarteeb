'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  getBankAccounts, createBankAccount, getBankTransactions, importBankTransactions, updateBankTransaction,
  getCompanyExpenses, createCompanyExpense, getReconciliationInvoicePayments, getLoanPaymentsForReconciliation,
  getReconciliationPayrollLines, getAllBankMatches, createBankMatches, deleteBankMatch, clearBankTransactionMatches,
  getBankPeriods, closeBankPeriod, reopenBankPeriod, getBankAudit, getBankAuditActors,
} from '@/lib/data';
import {
  parseCsvText, rowsToTransactions, usedByTarget, buildTargets, suggestMatches, matchRowsFor, targetKey,
  TARGET_FIELD, round2, monthOf, monthStart, daysBetween,
} from '@/lib/bankRecon';
import { fmtMoney, fmtNum, fmtDate } from '@/lib/format';
import { Loading, Empty, ErrorBar, Modal, DataTable, Input, Select, TextArea, Money, DateText, StatusPill, KpiCard } from '@/components';
import { toast } from '@/app/toast';

const STATUS = {
  unmatched: { label: 'غير مطابقة', labelEn: 'Unmatched', cls: 'p-wait' },
  partially_matched: { label: 'مطابقة جزئياً', labelEn: 'Partially Matched', cls: 'p-prog' },
  matched: { label: 'مطابقة', labelEn: 'Matched', cls: 'p-done' },
  excluded: { label: 'مستبعدة', labelEn: 'Excluded', cls: 'p-cancel' },
};
const KIND_LABEL = { payment: 'دفعة فاتورة', expense: 'مصروف', loan: 'قسط قرض', payroll: 'راتب', payroll_run: 'مسيّر رواتب' };
const AUDIT_LABEL = {
  import: 'استيراد حركة', match: 'مطابقة', unmatch: 'فك مطابقة', match_update: 'تعديل مطابقة', exclude: 'استبعاد',
  restore: 'إعادة للمراجعة', duplicate_dismissed: 'تأكيد أنها ليست مكررة', delete: 'حذف حركة', close: 'إقفال شهر', reopen: 'إعادة فتح شهر',
};
const METHOD_LABEL = { auto: 'تلقائية', manual: 'يدوية', created: 'مصروف منشأ من الحركة' };
const AUTO_THRESHOLD = 90;
const ACCOUNT_EMPTY = { name: '', bank_name: '', last_four: '', opening_balance: '0' };
const n = (v) => Number(v) || 0;
const money = (v) => `${fmtMoney(v)} ⃁`;
const monthLabel = (ym) => (ym ? new Date(`${ym}-15T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric' }) : '');
const openAmount = (tx) => round2(Math.abs(n(tx.amount)) - n(tx.matched_amount));

export default function BankReconciliationPage() {
  const fileRef = useRef(null);
  const [state, setState] = useState(null);
  const [accountId, setAccountId] = useState('');
  const [view, setView] = useState('transactions');
  const [filter, setFilter] = useState('all');
  const [month, setMonth] = useState('all');
  const [search, setSearch] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountForm, setAccountForm] = useState(ACCOUNT_EMPTY);
  const [preview, setPreview] = useState(null);
  const [manualTx, setManualTx] = useState(null);
  const [excludeTx, setExcludeTx] = useState(null);
  const [excludeReason, setExcludeReason] = useState('');

  async function load(preferredAccount) {
    try {
      const accounts = await getBankAccounts();
      const chosen = preferredAccount || accountId || accounts[0]?.id || '';
      const [transactions, expenses, payments, loanPayments, payrollLines, allMatches, periods, audit, actors] = await Promise.all([
        chosen ? getBankTransactions(chosen) : Promise.resolve([]),
        getCompanyExpenses().catch(() => []), getReconciliationInvoicePayments().catch(() => []),
        getLoanPaymentsForReconciliation().catch(() => []), getReconciliationPayrollLines().catch(() => []),
        getAllBankMatches().catch(() => []),
        chosen ? getBankPeriods(chosen).catch(() => []) : Promise.resolve([]),
        chosen ? getBankAudit(chosen).catch(() => []) : Promise.resolve([]),
        getBankAuditActors().catch(() => []),
      ]);
      setAccountId(chosen);
      setState({ accounts, transactions, expenses, payments, loanPayments, payrollLines, allMatches, periods, audit, actors });
    } catch (e) { setErr(e.message || 'تعذّر تحميل المطابقة البنكية'); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function changeAccount(id) { setAccountId(id); setMonth('all'); await load(id); }

  const derived = useMemo(() => {
    if (!state) return null;
    const used = usedByTarget(state.allMatches);
    const targets = buildTargets(state, used);
    const targetByKey = new Map(targets.map((t) => [`${t.kind}:${t.id}`, t]));
    const suggestions = suggestMatches(state.transactions, targets);
    const closedMonths = new Set(state.periods.filter((p) => p.status === 'closed').map((p) => monthOf(p.period_month)));
    const txById = new Map(state.transactions.map((t) => [t.id, t]));
    const rows = state.transactions.map((tx) => ({
      ...tx,
      locked: closedMonths.has(monthOf(tx.transaction_date)),
      suggestion: suggestions.get(tx.id) || null,
      sources: (tx.bank_reconciliation_matches || []).map((m) => ({ ...m, target: targetByKey.get(targetKey(m)) || null })),
      duplicateOf: tx.duplicate_of ? txById.get(tx.duplicate_of) || { id: tx.duplicate_of } : null,
    }));
    const months = [...new Set(rows.map((r) => monthOf(r.transaction_date)))].sort().reverse();
    return { used, targets, rows, closedMonths, months };
  }, [state]);

  if (err) return <ErrorBar message={err} />;
  if (!state || !derived) return <Loading />;
  const account = state.accounts.find((a) => a.id === accountId);
  const { rows, months, closedMonths } = derived;

  const inMonth = rows.filter((r) => month === 'all' || monthOf(r.transaction_date) === month);
  const q = search.trim().toLowerCase();
  const visible = inMonth.filter((r) => {
    if (q && !`${r.description} ${r.reference || ''} ${r.amount}`.toLowerCase().includes(q)) return false;
    if (filter === 'all') return true;
    if (filter === 'suggested') return Boolean(r.suggestion);
    if (filter === 'duplicates') return Boolean(r.duplicate_of) && r.status !== 'excluded';
    return r.status === filter;
  });
  const count = (fn) => inMonth.filter(fn).length;
  const stats = {
    total: inMonth.length,
    matched: count((r) => r.status === 'matched'),
    partial: count((r) => r.status === 'partially_matched'),
    unmatched: count((r) => r.status === 'unmatched'),
    excluded: count((r) => r.status === 'excluded'),
    duplicates: count((r) => r.duplicate_of && r.status !== 'excluded'),
    suggested: count((r) => r.suggestion),
    autoReady: inMonth.filter((r) => r.suggestion && r.suggestion.confidence >= AUTO_THRESHOLD && !r.locked).length,
    diff: round2(inMonth.filter((r) => r.status === 'partially_matched').reduce((s, r) => s + openAmount(r), 0)),
  };
  const balance = round2(n(account?.opening_balance) + rows.reduce((s, r) => s + n(r.amount), 0));

  // ---------- الحساب ----------
  async function addAccount(e) {
    e.preventDefault(); if (!accountForm.name.trim()) return;
    setSaving(true);
    try {
      const created = await createBankAccount({ name: accountForm.name.trim(), bank_name: accountForm.bank_name.trim() || null, last_four: accountForm.last_four || null, opening_balance: n(accountForm.opening_balance) });
      setAccountOpen(false); setAccountForm(ACCOUNT_EMPTY); toast('تمت إضافة الحساب'); await load(created.id);
    } catch (e2) { toast(e2.message || 'تعذّرت إضافة الحساب', 'err'); }
    finally { setSaving(false); }
  }

  // ---------- الاستيراد ----------
  async function pickFile(e) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file || !accountId) return;
    setSaving(true);
    try {
      let table;
      if (/\.xlsx$/i.test(file.name)) {
        const { readSheet } = await import('read-excel-file/browser');
        table = await readSheet(file);
      } else if (/\.xls$/i.test(file.name)) {
        throw new Error('صيغة .xls القديمة غير مدعومة — احفظ الكشف من Excel بصيغة .xlsx أو CSV');
      } else {
        table = parseCsvText(await file.text());
      }
      const { rows: parsed, errors } = rowsToTransactions(table, accountId);
      const existingIds = new Set(state.transactions.map((t) => t.external_id));
      const existingKey = new Set(state.transactions.map((t) => `${t.transaction_date}|${n(t.amount)}|${(t.description || '').trim().toLowerCase()}`));
      const lockedRows = parsed.filter((r) => closedMonths.has(monthOf(r.transaction_date)));
      const already = parsed.filter((r) => !closedMonths.has(monthOf(r.transaction_date)) && existingIds.has(r.external_id));
      const fresh = parsed.filter((r) => !closedMonths.has(monthOf(r.transaction_date)) && !existingIds.has(r.external_id));
      const suspect = fresh.filter((r) => existingKey.has(`${r.transaction_date}|${r.amount}|${r.description.trim().toLowerCase()}`) || /#\d+$/.test(r.external_id));
      const dates = parsed.map((r) => r.transaction_date).sort();
      setPreview({
        fileName: file.name, errors, fresh, already: already.length, locked: lockedRows.length, suspect: suspect.length,
        inflow: round2(fresh.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0)),
        outflow: round2(fresh.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0)),
        from: dates[0], to: dates[dates.length - 1],
      });
    } catch (e2) { toast(e2.message || 'تعذّرت قراءة الملف', 'err'); }
    finally { setSaving(false); }
  }
  async function confirmImport() {
    if (!preview?.fresh.length) { setPreview(null); return; }
    setSaving(true);
    try {
      const batch = `${new Date().toISOString()} · ${preview.fileName}`;
      const inserted = await importBankTransactions(preview.fresh.map((r) => ({ ...r, import_batch: batch })));
      const dups = inserted.filter((t) => t.duplicate_of).length;
      toast(`تم استيراد ${fmtNum(inserted.length)} حركة${dups ? ` — منها ${fmtNum(dups)} مكررة محتملة للمراجعة` : ''}`);
      setPreview(null); await load(accountId);
    } catch (e) { toast(e.message || 'تعذّر الاستيراد', 'err'); }
    finally { setSaving(false); }
  }

  // ---------- المطابقة ----------
  async function applySuggestion(tx, candidate, method = 'auto') {
    setSaving(true);
    try { await createBankMatches(matchRowsFor(tx, candidate, method)); toast('تم اعتماد المطابقة'); await load(accountId); }
    catch (e) { toast(e.message || 'تعذّر اعتماد المطابقة', 'err'); }
    finally { setSaving(false); }
  }
  async function autoMatchAll() {
    const ready = inMonth.filter((r) => r.suggestion && r.suggestion.confidence >= AUTO_THRESHOLD && !r.locked);
    if (!ready.length) return;
    setSaving(true);
    let ok = 0; const failed = [];
    for (const r of ready) {
      try { await createBankMatches(matchRowsFor(r, r.suggestion, 'auto')); ok += 1; }
      catch (e) { failed.push(e.message); }
    }
    toast(failed.length ? `طُوبقت ${fmtNum(ok)} وتعذّرت ${fmtNum(failed.length)}: ${failed[0]}` : `تمت مطابقة ${fmtNum(ok)} حركة تلقائياً`, failed.length ? 'err' : undefined);
    await load(accountId); setSaving(false);
  }
  async function removeMatch(match) {
    setSaving(true);
    try { await deleteBankMatch(match.id); toast('تم فك المطابقة'); await load(accountId); }
    catch (e) { toast(e.message || 'تعذّر فك المطابقة', 'err'); }
    finally { setSaving(false); }
  }
  async function resetTx(tx) {
    setSaving(true);
    try {
      if (tx.status === 'excluded') await updateBankTransaction(tx.id, { status: 'unmatched' });
      else await clearBankTransactionMatches(tx.id);
      toast('أُعيدت الحركة للمراجعة'); await load(accountId);
    } catch (e) { toast(e.message || 'تعذّر التراجع', 'err'); }
    finally { setSaving(false); }
  }
  async function confirmExclude(e) {
    e.preventDefault();
    if (excludeReason.trim().length < 3) { toast('اكتب سبب الاستبعاد', 'err'); return; }
    setSaving(true);
    try {
      await updateBankTransaction(excludeTx.id, { status: 'excluded', exclude_reason: excludeReason.trim() });
      setExcludeTx(null); setExcludeReason(''); toast('تم استبعاد الحركة'); await load(accountId);
    } catch (e2) { toast(e2.message || 'تعذّر الاستبعاد', 'err'); }
    finally { setSaving(false); }
  }
  async function dismissDuplicate(tx) {
    try { await updateBankTransaction(tx.id, { duplicate_of: null }); toast('تم تأكيد أنها حركة مستقلة'); await load(accountId); }
    catch (e) { toast(e.message || 'تعذّر التحديث', 'err'); }
  }
  async function expenseFromTransaction(tx) {
    const amount = openAmount(tx);
    if (n(tx.amount) >= 0 || amount <= 0) return;
    setSaving(true);
    try {
      const expense = await createCompanyExpense({ description: tx.description, category: 'other', amount, vat_amount: 0, expense_date: tx.transaction_date, payment_status: 'paid', payment_method: 'bank_transfer', recurrence: 'none', source: 'bank_reconciliation', account_id: tx.account_id || null, note: tx.reference ? `مرجع البنك: ${tx.reference}` : 'أُنشئ من المطابقة البنكية' });
      await createBankMatches([{ bank_transaction_id: tx.id, expense_id: expense.id, amount, method: 'created', confidence: 100 }]);
      toast('تم إنشاء المصروف ومطابقته'); await load(accountId);
    } catch (e) { toast(e.message || 'تعذّر إنشاء المصروف', 'err'); }
    finally { setSaving(false); }
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="sec-head bank-head">
        <div><h2>المطابقة البنكية</h2><p>مطابقة كشف الحساب مع الفواتير والمصاريف والرواتب وأقساط القروض، ثم الإقفال الشهري</p></div>
        <div className="bank-actions">
          <button className="btn ghost" onClick={() => setAccountOpen(true)}>+ حساب بنكي</button>
          {accountId && view === 'transactions' && <button className="btn ghost" disabled={saving || !stats.autoReady} onClick={autoMatchAll} title={`يعتمد كل اقتراح ثقته ${AUTO_THRESHOLD}% فأكثر`}>مطابقة تلقائية{stats.autoReady ? ` (${fmtNum(stats.autoReady)})` : ''}</button>}
          <button className="btn" disabled={!accountId || saving} onClick={() => fileRef.current?.click()}>استيراد Excel / CSV</button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={pickFile} />
        </div>
      </div>

      {state.accounts.length === 0 ? (
        <div className="card"><Empty title="لا يوجد حساب بنكي" desc="أضف الحساب أولاً، ثم استورد كشف Excel أو CSV." /><div className="empty-action"><button className="btn" onClick={() => setAccountOpen(true)}>إضافة حساب بنكي</button></div></div>
      ) : (
        <>
          <div className="card bank-toolbar">
            <Select label="الحساب" value={accountId} onChange={(e) => changeAccount(e.target.value)} options={state.accounts.map((a) => ({ value: a.id, label: `${a.name}${a.last_four ? ` • ${a.last_four}` : ''}` }))} />
            <Select label="الشهر" value={month} onChange={(e) => setMonth(e.target.value)} options={[{ value: 'all', label: 'كل الأشهر' }, ...months.map((m) => ({ value: m, label: `${monthLabel(m)}${closedMonths.has(m) ? ' 🔒' : ''}` }))]} />
            <div className="viewtoggle bank-views">
              {[['transactions', 'الحركات'], ['close', 'الإقفال الشهري'], ['audit', 'سجل المراجعة']].map(([k, l]) => <button key={k} className={`vt${view === k ? ' active' : ''}`} onClick={() => setView(k)}>{l}</button>)}
            </div>
          </div>

          <div className="kpis bank-kpis">
            <KpiCard label="الرصيد المحسوب" value={money(balance)} trend={account?.bank_name || account?.name} definition="الرصيد الافتتاحي للحساب مضافًا إليه صافي جميع الحركات المستوردة." period="جميع حركات الحساب المحدد" formula="الرصيد الافتتاحي + الإيداعات − المسحوبات" breakdown={[{ label: 'الرصيد الافتتاحي', value: money(account?.opening_balance || 0) }, { label: 'صافي الحركات', value: money(balance - n(account?.opening_balance)) }]} note="يجب أن يطابق الرصيد الختامي في كشف البنك." />
            <KpiCard tone="pos" label="مطابقة" value={fmtNum(stats.matched)} trend={`${stats.total ? fmtNum(Math.round(stats.matched / stats.total * 100)) : '0'}% من الحركات`} definition="حركات مربوطة بالكامل بمصدرها داخل النظام." period={month === 'all' ? 'كل الأشهر' : monthLabel(month)} formula="مطابقة ÷ إجمالي الحركات" breakdown={[{ label: 'الإجمالي', value: fmtNum(stats.total) }, { label: 'مطابقة', value: fmtNum(stats.matched) }, { label: 'مستبعدة', value: fmtNum(stats.excluded) }]} />
            <KpiCard tone="alert" label="تحتاج مراجعة" value={fmtNum(stats.unmatched + stats.partial)} trend={`${fmtNum(stats.suggested)} اقتراح · ${fmtNum(stats.partial)} جزئية`} definition="حركات غير مطابقة أو مطابقة جزئياً." period={month === 'all' ? 'كل الأشهر' : monthLabel(month)} formula="غير مطابقة + مطابقة جزئياً" breakdown={[{ label: 'غير مطابقة', value: fmtNum(stats.unmatched) }, { label: 'مطابقة جزئياً', value: fmtNum(stats.partial) }, { label: 'لها اقتراح', value: fmtNum(stats.suggested) }]} />
            <KpiCard tone={stats.duplicates || stats.diff ? 'alert' : 'pos'} label="مكررات وفروقات" value={fmtNum(stats.duplicates)} trend={stats.diff ? `فروقات ${money(stats.diff)}` : 'لا فروقات مفتوحة'} definition="حركات يُشتبه بتكرارها، ومبالغ غير مغطاة في الحركات المطابقة جزئياً." period={month === 'all' ? 'كل الأشهر' : monthLabel(month)} formula="مكرر محتمل: نفس المبلغ والمرجع، أو نفس التاريخ والوصف" breakdown={[{ label: 'مكررات محتملة', value: fmtNum(stats.duplicates) }, { label: 'فروقات غير مغطاة', value: money(stats.diff) }]} />
          </div>

          {view === 'transactions' && (
            <>
              <div className="bank-filterbar">
                <div className="viewtoggle bank-tabs">
                  {[['all', 'الكل', stats.total], ['suggested', 'مقترحة', stats.suggested], ['unmatched', 'غير مطابقة', stats.unmatched], ['partially_matched', 'جزئية', stats.partial], ['matched', 'مطابقة', stats.matched], ['duplicates', 'مكررة محتملة', stats.duplicates], ['excluded', 'مستبعدة', stats.excluded]].map(([key, label, c]) => (
                    <button key={key} className={`vt${filter === key ? ' active' : ''}`} onClick={() => setFilter(key)}>{label}{c ? <span className="tab-count">{fmtNum(c)}</span> : null}</button>
                  ))}
                </div>
                <input className="bank-search" placeholder="بحث بالوصف أو المرجع أو المبلغ" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="card" style={{ padding: '6px 0' }}>
                <DataTable rows={visible} pageSize={50} rowClassName={(r) => (r.locked ? 'bank-locked' : '')} empty={<Empty title="لا توجد حركات" desc="استورد كشف الحساب أو غيّر الفلتر." />} columns={[
                  {
                    key: 'description', label: 'الحركة', primary: true, render: (r) => (
                      <>
                        <span className="nm">{r.locked && '🔒 '}{r.description}</span>
                        {r.reference && <><br /><small dir="ltr">{r.reference}</small></>}
                        {r.duplicate_of && r.status !== 'excluded' && <><br /><span className="dup-flag">مكررة محتملة{r.duplicateOf?.transaction_date ? ` لحركة ${fmtDate(r.duplicateOf.transaction_date)}` : ''}</span></>}
                        {r.status === 'excluded' && r.exclude_reason && <><br /><small className="muted">سبب الاستبعاد: {r.exclude_reason}</small></>}
                      </>
                    ),
                  },
                  { key: 'transaction_date', label: 'التاريخ', render: (r) => <DateText v={r.transaction_date} /> },
                  { key: 'amount', label: 'المبلغ', render: (r) => <Money v={r.amount} className={n(r.amount) < 0 ? 'bank-out' : 'bank-in'} /> },
                  { key: 'status', label: 'الحالة', render: (r) => <StatusPill status={r.status} map={STATUS} /> },
                  {
                    key: 'source', label: 'المصدر في النظام', render: (r) => (
                      <div className="src-list">
                        {r.sources.map((m) => (
                          <div key={m.id} className="src-item">
                            {m.target ? <Link href={m.target.href}>{KIND_LABEL[m.target.kind]} · {m.target.label}</Link> : <span>{sourceFallback(m)}</span>}
                            <small><span dir="ltr">{fmtMoney(m.amount)}</span> · {METHOD_LABEL[m.method] || m.method}</small>
                          </div>
                        ))}
                        {r.status === 'partially_matched' && <small className="diff-note">المتبقي غير المطابق: {money(openAmount(r))}</small>}
                        {r.suggestion && (
                          <div className="match-suggestion">
                            <b>مقترح: {KIND_LABEL[r.suggestion.kind]} · {r.suggestion.label}</b>
                            <small className={r.suggestion.confidence >= AUTO_THRESHOLD ? 'conf-hi' : 'conf-mid'}>ثقة {fmtNum(r.suggestion.confidence)}%{r.suggestion.refMatch ? ' · المرجع مطابق' : ''}{r.suggestion.ambiguous ? ' · يوجد أكثر من احتمال' : ''}</small>
                          </div>
                        )}
                        {!r.sources.length && !r.suggestion && r.status !== 'excluded' && <span className="muted">—</span>}
                      </div>
                    ),
                  },
                  {
                    key: 'actions', label: 'إجراء', align: 'left', render: (r) => r.locked ? <small className="muted">شهر مقفل</small> : (
                      <div className="row-actions">
                        {r.suggestion && <button className="btn sm" disabled={saving} onClick={() => applySuggestion(r, r.suggestion, r.suggestion.confidence >= AUTO_THRESHOLD ? 'auto' : 'manual')}>اعتماد</button>}
                        {r.status !== 'excluded' && r.status !== 'matched' && <button className="btn ghost sm" disabled={saving} onClick={() => setManualTx(r)}>مطابقة يدوية</button>}
                        {r.status === 'unmatched' && n(r.amount) < 0 && !r.suggestion && !r.duplicate_of && <button className="btn ghost sm" disabled={saving} onClick={() => expenseFromTransaction(r)}>إنشاء مصروف</button>}
                        {r.duplicate_of && r.status !== 'excluded' && <button className="btn ghost sm" disabled={saving} onClick={() => dismissDuplicate(r)}>ليست مكررة</button>}
                        {r.status === 'unmatched' && <button className="btn ghost sm" disabled={saving} onClick={() => { setExcludeTx(r); setExcludeReason(r.duplicate_of ? 'حركة مكررة في الكشف' : ''); }}>استبعاد</button>}
                        {r.status === 'matched' && <button className="btn ghost sm" disabled={saving} onClick={() => setManualTx(r)}>عرض</button>}
                        {['matched', 'partially_matched', 'excluded'].includes(r.status) && <button className="btn ghost sm" disabled={saving} onClick={() => resetTx(r)}>تراجع</button>}
                      </div>
                    ),
                  },
                ]} />
              </div>
              <p className="csv-hint">الأعمدة المدعومة: التاريخ، الوصف/البيان، المبلغ أو مدين/دائن، المرجع — بالعربية أو الإنجليزية، ويتم تخطي أسطر العنوان والإجماليات تلقائياً.</p>
            </>
          )}

          {view === 'close' && <ClosePanel account={account} rows={rows} periods={state.periods} months={months} saving={saving} setSaving={setSaving} reload={() => load(accountId)} goTo={(m, f) => { setMonth(m); setFilter(f); setView('transactions'); }} />}
          {view === 'audit' && <AuditPanel audit={state.audit} rows={rows} actors={state.actors} />}
        </>
      )}

      <Modal open={accountOpen} onClose={() => !saving && setAccountOpen(false)} title="حساب بنكي جديد" subtitle="لا تُخزّن بيانات الدخول أو رقم الحساب الكامل" as="form" onSubmit={addAccount} size="sm" footer={<><button type="button" className="btn ghost" onClick={() => setAccountOpen(false)}>إلغاء</button><button className="btn" disabled={saving}>حفظ الحساب</button></>}>
        <Input label="اسم مختصر للحساب" value={accountForm.name} onChange={(e) => setAccountForm((f) => ({ ...f, name: e.target.value }))} placeholder="الحساب التشغيلي" required />
        <Input label="اسم البنك" value={accountForm.bank_name} onChange={(e) => setAccountForm((f) => ({ ...f, bank_name: e.target.value }))} />
        <Input label="آخر 4 أرقام" ltr maxLength="4" pattern="[0-9]{4}" value={accountForm.last_four} onChange={(e) => setAccountForm((f) => ({ ...f, last_four: e.target.value.replace(/\D/g, '').slice(0, 4) }))} />
        <Input label="الرصيد الافتتاحي" type="number" step="0.01" ltr value={accountForm.opening_balance} onChange={(e) => setAccountForm((f) => ({ ...f, opening_balance: e.target.value }))} />
      </Modal>

      <Modal open={Boolean(preview)} onClose={() => !saving && setPreview(null)} title="مراجعة الاستيراد" subtitle={preview?.fileName} size="sm" footer={<><button type="button" className="btn ghost" onClick={() => setPreview(null)}>إلغاء</button><button className="btn" disabled={saving || !preview?.fresh.length} onClick={confirmImport}>استيراد {preview?.fresh.length ? fmtNum(preview.fresh.length) : ''} حركة</button></>}>
        {preview && (
          <div className="import-preview">
            <div className="ip-row"><span>الفترة</span><b>{fmtDate(preview.from)} ← {fmtDate(preview.to)}</b></div>
            <div className="ip-row"><span>حركات جديدة</span><b>{fmtNum(preview.fresh.length)}</b></div>
            <div className="ip-row"><span>إيداعات / مسحوبات</span><b><span className="bank-in">{money(preview.inflow)}</span> / <span className="bank-out">{money(preview.outflow)}</span></b></div>
            {preview.already > 0 && <div className="ip-row"><span>مستوردة سابقاً (ستُتخطى)</span><b>{fmtNum(preview.already)}</b></div>}
            {preview.locked > 0 && <div className="ip-row warn"><span>ضمن أشهر مقفلة (ستُتخطى)</span><b>{fmtNum(preview.locked)}</b></div>}
            {preview.suspect > 0 && <div className="ip-row warn"><span>مكررة محتملة (ستُعلَّم للمراجعة)</span><b>{fmtNum(preview.suspect)}</b></div>}
            {preview.errors.length > 0 && <div className="ip-errors"><b>أسطر تم تخطيها ({fmtNum(preview.errors.length)}):</b>{preview.errors.slice(0, 5).map((e) => <small key={e}>{e}</small>)}</div>}
          </div>
        )}
      </Modal>

      <Modal open={Boolean(excludeTx)} onClose={() => !saving && setExcludeTx(null)} title="استبعاد حركة" subtitle={excludeTx ? `${excludeTx.description} · ${money(excludeTx.amount)}` : ''} as="form" onSubmit={confirmExclude} size="sm" footer={<><button type="button" className="btn ghost" onClick={() => setExcludeTx(null)}>إلغاء</button><button className="btn" disabled={saving}>استبعاد</button></>}>
        <TextArea label="سبب الاستبعاد (يُحفظ في سجل المراجعة)" value={excludeReason} onChange={(e) => setExcludeReason(e.target.value)} placeholder="مثال: تحويل بين حسابات الشركة" required />
      </Modal>

      {manualTx && <ManualMatchModal tx={rows.find((r) => r.id === manualTx.id) || manualTx} targets={derived.targets} saving={saving} setSaving={setSaving} onRemove={removeMatch} onClose={() => setManualTx(null)} reload={() => load(accountId)} />}
    </>
  );
}

function sourceFallback(m) {
  if (m.payroll_line_id) return 'راتب (يتطلب صلاحية الرواتب للعرض)';
  if (m.expense_id) return 'مصروف';
  if (m.loan_payment_id) return 'قسط قرض';
  return 'دفعة فاتورة';
}

// ---------- المطابقة اليدوية (متعددة وجزئية) ----------
function ManualMatchModal({ tx, targets, saving, setSaving, onRemove, onClose, reload }) {
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState({});
  const [note, setNote] = useState('');
  const direction = n(tx.amount) > 0 ? 'in' : 'out';
  const remainingTx = openAmount(tx);
  const candidates = useMemo(() => {
    const s = q.trim().toLowerCase();
    return targets
      .filter((t) => t.direction === direction && t.remaining > 0.005 && (kind === 'all' || t.kind === kind))
      .filter((t) => !s || `${t.label} ${t.sub} ${t.amount}`.toLowerCase().includes(s))
      .map((t) => ({ ...t, score: Math.abs(t.remaining - remainingTx) * 10 + daysBetween(tx.transaction_date, t.date || tx.transaction_date) }))
      .sort((a, b) => a.score - b.score)
      .slice(0, 60);
  }, [targets, direction, kind, q, remainingTx, tx.transaction_date]);
  const selected = Object.entries(picked).filter(([, v]) => v.on);
  const total = round2(selected.reduce((s, [, v]) => s + n(v.amount), 0));
  const after = round2(remainingTx - total);
  const toggle = (t) => setPicked((p) => {
    const cur = p[`${t.kind}:${t.id}`];
    const left = round2(remainingTx - total);
    return { ...p, [`${t.kind}:${t.id}`]: cur?.on ? { ...cur, on: false } : { on: true, amount: String(round2(Math.max(0, Math.min(t.remaining, left > 0 ? left : t.remaining)))), t } };
  });
  async function save() {
    if (!selected.length) return;
    if (after < -0.005) { toast('مجموع المطابقة أكبر من المتبقي من الحركة', 'err'); return; }
    const bad = selected.find(([, v]) => !(n(v.amount) > 0) || n(v.amount) > v.t.remaining + 0.005);
    if (bad) { toast(`المبلغ غير صالح لـ ${bad[1].t.label}`, 'err'); return; }
    setSaving(true);
    try {
      await createBankMatches(selected.map(([, v]) => ({ bank_transaction_id: tx.id, [TARGET_FIELD[v.t.kind]]: v.t.id, amount: round2(n(v.amount)), method: 'manual', confidence: 100, note: note.trim() || null })));
      toast(after > 0.005 ? `مطابقة جزئية — المتبقي ${money(after)}` : 'تمت المطابقة'); setPicked({}); await reload(); onClose();
    } catch (e) { toast(e.message || 'تعذّرت المطابقة', 'err'); }
    finally { setSaving(false); }
  }
  return (
    <Modal open onClose={() => !saving && onClose()} title={tx.status === 'matched' ? 'تفاصيل المطابقة' : 'مطابقة يدوية'} subtitle={`${tx.description} · ${fmtDate(tx.transaction_date)}`} size="lg" footer={<><button type="button" className="btn ghost" onClick={onClose}>إغلاق</button>{remainingTx > 0.005 && !tx.locked && <button className="btn" disabled={saving || !selected.length} onClick={save}>{after > 0.005 && selected.length ? 'حفظ كمطابقة جزئية' : 'حفظ المطابقة'}</button>}</>}>
      <div className="mm-summary">
        <div><span>مبلغ الحركة</span><b><Money v={tx.amount} className={n(tx.amount) < 0 ? 'bank-out' : 'bank-in'} /></b></div>
        <div><span>مطابق</span><b>{money(n(tx.matched_amount))}</b></div>
        <div><span>المتبقي</span><b>{money(remainingTx)}</b></div>
        {selected.length > 0 && <div><span>بعد الحفظ</span><b className={after > 0.005 ? 'diff-note' : 'conf-hi'}>{after > 0.005 ? `جزئية — فرق ${money(after)}` : 'مطابقة بالكامل'}</b></div>}
      </div>
      {tx.sources?.length > 0 && (
        <div className="mm-existing">
          <b>المطابقات الحالية</b>
          {tx.sources.map((m) => (
            <div key={m.id} className="mm-line">
              <span>{m.target ? <Link href={m.target.href}>{KIND_LABEL[m.target.kind]} · {m.target.label}</Link> : sourceFallback(m)}</span>
              <span dir="ltr">{fmtMoney(m.amount)}</span>
              <small className="muted">{METHOD_LABEL[m.method]}{m.confidence ? ` · ${fmtNum(m.confidence)}%` : ''}{m.note ? ` · ${m.note}` : ''}</small>
              {!tx.locked && <button className="btn ghost sm" disabled={saving} onClick={() => onRemove(m)}>فك</button>}
            </div>
          ))}
        </div>
      )}
      {remainingTx > 0.005 && !tx.locked && (
        <>
          <div className="mm-filters">
            <Select label="النوع" value={kind} onChange={(e) => setKind(e.target.value)} options={direction === 'in' ? [{ value: 'all', label: 'دفعات الفواتير' }] : [{ value: 'all', label: 'الكل' }, { value: 'expense', label: 'مصاريف' }, { value: 'payroll', label: 'رواتب' }, { value: 'loan', label: 'أقساط قروض' }]} />
            <Input label="بحث" value={q} onChange={(e) => setQ(e.target.value)} placeholder="رقم فاتورة، اسم، مبلغ…" />
          </div>
          <div className="mm-list">
            {candidates.length === 0 && <Empty title="لا توجد بنود مفتوحة مطابقة" desc={direction === 'out' ? 'يمكنك إنشاء مصروف من الحركة مباشرة.' : 'سجّل دفعة على الفاتورة أولاً ثم طابقها.'} />}
            {candidates.map((t) => {
              const key = `${t.kind}:${t.id}`; const p = picked[key];
              return (
                <label key={key} className={`mm-cand${p?.on ? ' on' : ''}`}>
                  <input type="checkbox" checked={Boolean(p?.on)} onChange={() => toggle(t)} />
                  <span className="mm-main"><b>{KIND_LABEL[t.kind]} · {t.label}</b><small>{t.sub ? `${t.sub} · ` : ''}{t.date ? fmtDate(t.date) : ''}{t.remaining < t.amount ? ` · المتبقي من ${fmtMoney(t.amount)}` : ''}</small></span>
                  <span dir="ltr" className={Math.abs(t.remaining - remainingTx) < 0.01 ? 'conf-hi' : ''}>{fmtMoney(t.remaining)}</span>
                  {p?.on && <input className="mm-amt" type="number" step="0.01" min="0.01" max={t.remaining} dir="ltr" value={p.amount} onChange={(e) => setPicked((s) => ({ ...s, [key]: { ...s[key], amount: e.target.value } }))} />}
                </label>
              );
            })}
          </div>
          <Input label="ملاحظة (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: الفرق رسوم تحويل" />
        </>
      )}
    </Modal>
  );
}

// ---------- الإقفال الشهري ----------
function ClosePanel({ account, rows, periods, months, saving, setSaving, reload, goTo }) {
  const periodByMonth = new Map(periods.map((p) => [monthOf(p.period_month), p]));
  const openMonths = months.filter((m) => periodByMonth.get(m)?.status !== 'closed').sort();
  const [sel, setSel] = useState(openMonths[0] || months[0] || '');
  const [statement, setStatement] = useState('');
  const [note, setNote] = useState('');
  const [reopen, setReopen] = useState(null);
  const [reason, setReason] = useState('');
  useEffect(() => { if (!sel && (openMonths[0] || months[0])) setSel(openMonths[0] || months[0]); }, [months.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const mRows = rows.filter((r) => monthOf(r.transaction_date) === sel);
  const monthEnd = sel ? new Date(Date.UTC(Number(sel.slice(0, 4)), Number(sel.slice(5, 7)), 0)).toISOString().slice(0, 10) : '';
  const computed = round2(n(account?.opening_balance) + rows.filter((r) => r.transaction_date <= monthEnd).reduce((s, r) => s + n(r.amount), 0));
  const unmatched = mRows.filter((r) => r.status === 'unmatched');
  const partial = mRows.filter((r) => r.status === 'partially_matched');
  const dups = mRows.filter((r) => r.duplicate_of && r.status !== 'excluded');
  const period = periodByMonth.get(sel);
  const isClosed = period?.status === 'closed';
  const earlierOpen = openMonths.find((m) => m < sel);
  const diff = statement === '' ? null : round2(n(statement) - computed);
  const blockers = [
    unmatched.length && `${fmtNum(unmatched.length)} حركة غير مطابقة`,
    partial.length && `${fmtNum(partial.length)} حركة مطابقة جزئياً`,
    dups.length && `${fmtNum(dups.length)} حركة مكررة محتملة`,
    earlierOpen && `شهر ${monthLabel(earlierOpen)} ما زال مفتوحاً (الإقفال بالتسلسل)`,
    diff !== null && Math.abs(diff) > 0.009 && `فرق ${money(diff)} بين رصيد الكشف والرصيد المحسوب`,
    statement === '' && 'أدخل الرصيد الختامي من كشف البنك',
  ].filter(Boolean);
  const sum = (list, fn) => round2(list.reduce((s, r) => s + fn(r), 0));

  async function doClose() {
    setSaving(true);
    try { await closeBankPeriod(account.id, monthStart(sel), n(statement), note.trim()); toast(`تم إقفال ${monthLabel(sel)}`); setStatement(''); setNote(''); await reload(); }
    catch (e) { toast(e.message || 'تعذّر الإقفال', 'err'); }
    finally { setSaving(false); }
  }
  async function doReopen(e) {
    e.preventDefault();
    setSaving(true);
    try { await reopenBankPeriod(reopen.id, reason.trim()); toast('أُعيد فتح الشهر'); setReopen(null); setReason(''); await reload(); }
    catch (e2) { toast(e2.message || 'تعذّرت إعادة الفتح', 'err'); }
    finally { setSaving(false); }
  }

  if (!months.length) return <div className="card"><Empty title="لا توجد حركات بعد" desc="استورد كشف الحساب لتبدأ المطابقة والإقفال." /></div>;
  return (
    <div className="close-grid">
      <div className="card close-report" id="close-report">
        <div className="cr-head">
          <Select label="شهر الإقفال" value={sel} onChange={(e) => { setSel(e.target.value); setStatement(''); }} options={months.slice().sort().map((m) => ({ value: m, label: `${monthLabel(m)}${periodByMonth.get(m)?.status === 'closed' ? ' 🔒' : ''}` }))} />
          <button className="btn ghost sm no-print" onClick={() => window.print()}>طباعة التقرير</button>
        </div>
        <h3>تقرير ما قبل الإقفال — {monthLabel(sel)}</h3>
        <div className="cr-stats">
          <div><span>إجمالي الحركات</span><b>{fmtNum(mRows.length)}</b></div>
          <div><span>مطابقة</span><b className="conf-hi">{fmtNum(mRows.filter((r) => r.status === 'matched').length)}</b></div>
          <div><span>مستبعدة</span><b>{fmtNum(mRows.filter((r) => r.status === 'excluded').length)}</b></div>
          <div><span>غير مطابقة</span><b className={unmatched.length ? 'bank-out' : ''}>{fmtNum(unmatched.length)}</b></div>
          <div><span>جزئية</span><b className={partial.length ? 'bank-out' : ''}>{fmtNum(partial.length)}</b></div>
          <div><span>مكررة محتملة</span><b className={dups.length ? 'bank-out' : ''}>{fmtNum(dups.length)}</b></div>
          <div><span>الإيداعات</span><b className="bank-in">{money(sum(mRows, (r) => Math.max(0, n(r.amount))))}</b></div>
          <div><span>المسحوبات</span><b className="bank-out">{money(sum(mRows, (r) => Math.max(0, -n(r.amount))))}</b></div>
          <div><span>الرصيد المحسوب نهاية الشهر</span><b>{money(computed)}</b></div>
        </div>

        {[['غير مطابقة', unmatched, 'unmatched'], ['مطابقة جزئياً', partial, 'partially_matched'], ['مكررة محتملة', dups, 'duplicates']].map(([title, list, f]) => list.length > 0 && (
          <div key={f} className="cr-section">
            <div className="cr-section-head"><b>{title} ({fmtNum(list.length)})</b><button className="btn ghost sm no-print" onClick={() => goTo(sel, f)}>معالجتها</button></div>
            <table className="cr-table">
              <thead><tr><th>التاريخ</th><th>الوصف</th><th>المرجع</th><th>المبلغ</th><th>غير المطابق</th></tr></thead>
              <tbody>{list.map((r) => <tr key={r.id}><td>{fmtDate(r.transaction_date)}</td><td>{r.description}</td><td dir="ltr">{r.reference || '—'}</td><td dir="ltr">{fmtMoney(r.amount)}</td><td dir="ltr">{fmtMoney(openAmount(r))}</td></tr>)}</tbody>
              <tfoot><tr><td colSpan={3}>الإجمالي</td><td dir="ltr">{fmtMoney(sum(list, (r) => n(r.amount)))}</td><td dir="ltr">{fmtMoney(sum(list, openAmount))}</td></tr></tfoot>
            </table>
          </div>
        ))}
        {!unmatched.length && !partial.length && !dups.length && <p className="cr-ok">✓ كل حركات الشهر مطابقة أو مستبعدة بسبب موثّق.</p>}

        {isClosed ? (
          <div className="cr-closed">
            <b>🔒 الشهر مقفل</b>
            <span>رصيد الكشف {money(period.statement_closing_balance)} · المحسوب {money(period.computed_balance)} · أُقفل {fmtDate(period.closed_at)}</span>
            {period.note && <small>{period.note}</small>}
          </div>
        ) : (
          <div className="cr-close no-print">
            <Input label="الرصيد الختامي في كشف البنك" type="number" step="0.01" ltr value={statement} onChange={(e) => setStatement(e.target.value)} hint={diff !== null ? (Math.abs(diff) > 0.009 ? `الفرق: ${fmtMoney(diff)}` : 'لا يوجد فرق ✓') : undefined} />
            <Input label="ملاحظة الإقفال" value={note} onChange={(e) => setNote(e.target.value)} />
            {blockers.length > 0 && <ul className="cr-blockers">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
            <button className="btn" disabled={saving || blockers.length > 0} onClick={doClose}>إقفال {monthLabel(sel)}</button>
          </div>
        )}
      </div>

      <div className="card close-history no-print">
        <b>سجل الإقفالات</b>
        {periods.length === 0 && <small className="muted">لم يُقفل أي شهر بعد.</small>}
        {periods.map((p) => (
          <div key={p.id} className="ch-row">
            <div><b>{monthLabel(monthOf(p.period_month))}</b><StatusPill status={p.status} map={{ closed: { label: 'مقفل', cls: 'p-done' }, reopened: { label: 'أُعيد فتحه', cls: 'p-prog' } }} /></div>
            <small>رصيد الكشف {money(p.statement_closing_balance)} · {fmtNum(p.snapshot?.transactions || 0)} حركة</small>
            {p.status === 'reopened' && p.reopen_reason && <small className="muted">سبب إعادة الفتح: {p.reopen_reason}</small>}
            {p.status === 'closed' && <button className="btn ghost sm" onClick={() => { setReopen(p); setReason(''); }}>إعادة فتح</button>}
          </div>
        ))}
      </div>

      <Modal open={Boolean(reopen)} onClose={() => !saving && setReopen(null)} title="إعادة فتح شهر مقفل" subtitle={reopen ? monthLabel(monthOf(reopen.period_month)) : ''} as="form" onSubmit={doReopen} size="sm" footer={<><button type="button" className="btn ghost" onClick={() => setReopen(null)}>إلغاء</button><button className="btn" disabled={saving}>إعادة الفتح</button></>}>
        <TextArea label="السبب (إلزامي ويُحفظ في سجل المراجعة)" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} />
      </Modal>
    </div>
  );
}

// ---------- سجل المراجعة ----------
function AuditPanel({ audit, rows, actors }) {
  const txById = new Map(rows.map((r) => [r.id, r]));
  const actorName = new Map((actors || []).map((u) => [u.user_id, u.display_name || u.email]));
  if (!audit.length) return <div className="card"><Empty title="لا توجد عمليات بعد" desc="كل استيراد ومطابقة واستبعاد وإقفال يُسجَّل هنا تلقائياً." /></div>;
  return (
    <div className="card" style={{ padding: '6px 0' }}>
      <DataTable rows={audit} pageSize={50} columns={[
        { key: 'created_at', label: 'الوقت', render: (a) => <span dir="ltr" className="amt">{new Date(a.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</span> },
        { key: 'action', label: 'العملية', primary: true, render: (a) => <b>{AUDIT_LABEL[a.action] || a.action}</b> },
        {
          key: 'details', label: 'التفاصيل', render: (a) => {
            const d = a.details || {}; const tx = txById.get(a.bank_transaction_id);
            const parts = [];
            if (tx) parts.push(`${tx.description} (${fmtMoney(tx.amount)})`);
            else if (d.description) parts.push(`${d.description} (${fmtMoney(d.amount)})`);
            if (d.target_type) parts.push(`${KIND_LABEL[{ invoice_payment: 'payment', loan_payment: 'loan', payroll_line: 'payroll', expense: 'expense' }[d.target_type]]} بمبلغ ${fmtMoney(d.amount)}`);
            if (d.method) parts.push(METHOD_LABEL[d.method]);
            if (d.reason) parts.push(`السبب: ${d.reason}`);
            if (a.action === 'close') parts.push(`${monthLabel(monthOf(a.period_month))} · رصيد ${fmtMoney(d.statement_balance)}`);
            if (a.action === 'reopen') parts.push(monthLabel(monthOf(a.period_month)));
            if (d.duplicate_of) parts.push('مكررة محتملة');
            return <small>{parts.join(' · ') || '—'}</small>;
          },
        },
        { key: 'actor', label: 'المستخدم', render: (a) => <small className="muted">{a.actor ? actorName.get(a.actor) || <span dir="ltr">{a.actor.slice(0, 8)}</span> : 'النظام'}</small> },
      ]} />
    </div>
  );
}

const CSS = `
.bank-head{margin-bottom:16px;align-items:flex-end}.bank-head h2{margin:0}.bank-head p{margin:5px 0 0;color:var(--muted);font-size:13px}
.bank-actions,.row-actions{display:flex;gap:8px;flex-wrap:wrap}
.bank-toolbar{display:flex;align-items:flex-end;gap:14px;margin-bottom:14px;padding:14px;flex-wrap:wrap}.bank-toolbar .field{margin:0;min-width:200px}.bank-views{margin-inline-start:auto}
.csv-hint{color:var(--muted);font-size:12px;margin:10px 4px 0}
.bank-kpis{grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:14px}
.bank-filterbar{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:12px}
.bank-tabs{width:max-content;max-width:100%;overflow:auto}.tab-count{margin-inline-start:6px;font-size:11px;opacity:.7}
.bank-search{min-width:240px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:inherit;font:inherit}
.bank-out{color:var(--neg)}.bank-in{color:var(--green)}.muted{color:var(--muted)}
.src-list{display:flex;flex-direction:column;gap:6px;min-width:190px}.src-item{display:flex;flex-direction:column;gap:2px}.src-item a{color:inherit;text-decoration:underline;text-underline-offset:3px}.src-item small{color:var(--muted)}
.match-suggestion{display:flex;flex-direction:column;gap:3px;border-inline-start:3px solid var(--gold-bg);padding-inline-start:8px}
.conf-hi{color:var(--green)}.conf-mid{color:#8a651f}.diff-note{color:var(--neg);font-size:12px}
.dup-flag{display:inline-block;margin-top:4px;font-size:11px;padding:2px 8px;border-radius:999px;background:var(--neg-bg);color:var(--neg)}
tr.bank-locked td{opacity:.75}
.empty-action{text-align:center;padding-bottom:20px}
.import-preview{display:flex;flex-direction:column;gap:8px}.ip-row{display:flex;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:10px;background:var(--surface-2)}.ip-row.warn{background:var(--gold-bg)}.ip-errors{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--neg)}
.mm-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px}.mm-summary>div{background:var(--surface-2);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:4px}.mm-summary span{font-size:12px;color:var(--muted)}
.mm-existing{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}.mm-line{display:grid;grid-template-columns:1fr auto auto auto;gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--line);border-radius:10px}
.mm-filters{display:grid;grid-template-columns:200px 1fr;gap:10px}
.mm-list{display:flex;flex-direction:column;gap:6px;max-height:340px;overflow:auto;margin:6px 0 12px}
.mm-cand{display:grid;grid-template-columns:auto 1fr auto auto;gap:10px;align-items:center;padding:9px 10px;border:1px solid var(--line);border-radius:10px;cursor:pointer}.mm-cand.on{border-color:var(--green);background:var(--pos-bg)}
.mm-main{display:flex;flex-direction:column;gap:2px}.mm-main small{color:var(--muted)}.mm-amt{width:110px;padding:6px 8px;border:1px solid var(--line);border-radius:8px}
.close-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px;align-items:start}
.close-report{padding:16px}.cr-head{display:flex;justify-content:space-between;align-items:flex-end;gap:10px}.cr-head .field{margin:0;min-width:220px}.close-report h3{margin:16px 0 10px}
.cr-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.cr-stats>div{background:var(--surface-2);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:4px}.cr-stats span{font-size:12px;color:var(--muted)}
.cr-section{margin-top:16px}.cr-section-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.cr-table{width:100%;font-size:13px;border-collapse:collapse}.cr-table th,.cr-table td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:start}.cr-table tfoot td{font-weight:700}
.cr-ok{color:var(--green);margin:16px 0 0}
.cr-close{margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:end}.cr-close .btn,.cr-blockers{grid-column:1/-1}.cr-blockers{margin:0;padding-inline-start:18px;color:var(--neg);font-size:13px}
.cr-closed{margin-top:18px;padding:12px;border-radius:10px;background:var(--pos-bg);display:flex;flex-direction:column;gap:4px}
.close-history{padding:14px;display:flex;flex-direction:column;gap:10px}.ch-row{display:flex;flex-direction:column;gap:4px;padding:10px;border:1px solid var(--line);border-radius:10px}.ch-row>div{display:flex;justify-content:space-between;align-items:center}.ch-row .btn{align-self:flex-start}
@media(max-width:1100px){.bank-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.close-grid{grid-template-columns:1fr}}
@media(max-width:850px){.bank-kpis{grid-template-columns:1fr}.bank-toolbar{align-items:stretch;flex-direction:column}.bank-toolbar .field{min-width:0}.bank-views{margin:0}.bank-head{align-items:flex-start}.cr-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.cr-close,.mm-filters{grid-template-columns:1fr}.bank-search{min-width:0;width:100%}.mm-cand{grid-template-columns:auto 1fr auto}.mm-amt{grid-column:2/-1;width:100%}}
@media print{.no-print,.sidebar,nav,header,.bank-head,.bank-toolbar,.bank-kpis,.close-history{display:none!important}.close-grid{display:block}.close-report{box-shadow:none;border:0}}
`;
