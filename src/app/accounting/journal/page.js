'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  getJournalEntries, getJournalEntryLines, getChartOfAccounts,
  createManualJournalEntry, reverseJournalEntry,
} from '@/lib/data';
import { fmtMoney, fmtDate } from '@/lib/format';
import { Loading, Empty, ErrorBar, Modal, DataTable, Input, Select, TextArea, Money } from '@/components';
import { toast } from '@/app/toast';

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 7)}-01`;
const SOURCE_LABEL = {
  invoices: 'فاتورة', invoice_payments: 'دفعة فاتورة', company_expenses: 'مصروف شركة',
  payroll_runs: 'مسيّر رواتب', loans: 'قرض', loan_payments: 'سداد قرض',
};
const EMPTY_LINE = { account_code: '', debit: '', credit: '' };

export default function JournalPage() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [expanded, setExpanded] = useState(null);
  const [lines, setLines] = useState({});
  const [accounts, setAccounts] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ entry_date: today(), description: '' });
  const [formLines, setFormLines] = useState([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  async function load() {
    try { setEntries(await getJournalEntries({ from, to })); } catch (loadError) { setError(loadError.message || 'تعذّر تحميل القيود'); }
  }
  useEffect(() => { load(); }, [from, to]);
  useEffect(() => { getChartOfAccounts().then(setAccounts).catch(() => {}); }, []);

  async function toggleExpand(entry) {
    if (expanded === entry.id) { setExpanded(null); return; }
    setExpanded(entry.id);
    if (!lines[entry.id]) {
      try {
        const entryLines = await getJournalEntryLines(entry.id);
        setLines((prev) => ({ ...prev, [entry.id]: entryLines }));
      } catch (lineError) { toast(lineError.message || 'تعذّر تحميل سطور القيد', 'error'); }
    }
  }

  async function doReverse(entry) {
    if (!window.confirm(`عكس القيد ${entry.entry_no}؟ سيُنشأ قيد جديد معكوس.`)) return;
    try { await reverseJournalEntry(entry.id); await load(); toast('تم إنشاء قيد العكس'); }
    catch (reverseError) { toast(reverseError.message || 'تعذّر عكس القيد', 'error'); }
  }

  const totals = useMemo(() => {
    const rows = formLines.filter((line) => line.account_code);
    const debit = rows.reduce((sum, line) => sum + Number(line.debit || 0), 0);
    const credit = rows.reduce((sum, line) => sum + Number(line.credit || 0), 0);
    return { debit, credit, balanced: rows.length >= 2 && Math.abs(debit - credit) < 0.01 && debit > 0 };
  }, [formLines]);

  function openNew() {
    setForm({ entry_date: today(), description: '' });
    setFormLines([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);
    setFormError('');
    setOpen(true);
  }

  function updateLine(index, patch) {
    setFormLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.description.trim()) { setFormError('أدخل وصف القيد'); return; }
    if (!totals.balanced) { setFormError('القيد غير متوازن — تحقق من المدين والدائن'); return; }
    setSaving(true);
    try {
      await createManualJournalEntry({
        entry_date: form.entry_date,
        description: form.description.trim(),
        lines: formLines.filter((line) => line.account_code).map((line) => ({
          account_code: line.account_code, debit: Number(line.debit || 0), credit: Number(line.credit || 0),
        })),
      });
      setOpen(false);
      await load();
      toast('تم تسجيل القيد اليدوي');
    } catch (submitError) {
      setFormError(submitError.message || 'تعذّر حفظ القيد');
    } finally { setSaving(false); }
  }

  if (error) return <ErrorBar message={error} />;
  if (!entries) return <Loading />;

  return (
    <>
      <div className="sec-head">
        <div><h2>القيود اليومية</h2><p>كل القيود مُرحَّلة فورًا (Posted) — تلقائيًا من المستندات أو يدويًا للتسويات.</p></div>
        <button className="btn" type="button" onClick={openNew}>+ قيد يدوي</button>
      </div>

      <div className="card" style={{ display: 'flex', gap: 12, padding: 14, marginBottom: 14, flexWrap: 'wrap' }}>
        <Input label="من تاريخ" type="date" value={from} ltr onChange={(e) => setFrom(e.target.value)} />
        <Input label="إلى تاريخ" type="date" value={to} ltr onChange={(e) => setTo(e.target.value)} />
      </div>

      <div className="card" style={{ padding: 0 }}>
        <DataTable
          rows={entries}
          empty={<Empty title="لا قيود ضمن الفترة" desc="غيّر فلتر التاريخ." />}
          onRowClick={toggleExpand}
          columns={[
            { key: 'entry_no', label: 'رقم القيد', primary: true, ltr: true },
            { key: 'entry_date', label: 'التاريخ', render: (row) => fmtDate(row.entry_date) },
            { key: 'description', label: 'الوصف' },
            { key: 'source', label: 'المصدر', render: (row) => (row.source_table ? (SOURCE_LABEL[row.source_table] || row.source_table) : 'يدوي') },
            { key: 'is_manual', label: 'عكس', render: (row) => (row.is_manual && !row.reversed_by ? <button type="button" className="btn ghost sm" onClick={(e) => { e.stopPropagation(); doReverse(row); }}>عكس القيد</button> : (row.reversed_by ? 'مُعكوس' : '—')) },
          ]}
        />
      </div>

      {expanded && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>سطور القيد</h3>
          <DataTable
            rows={lines[expanded] || []}
            empty={<Loading />}
            columns={[
              { key: 'account', label: 'الحساب', primary: true, render: (row) => `${row.chart_of_accounts?.code || ''} — ${row.chart_of_accounts?.name_ar || ''}` },
              { key: 'debit', label: 'مدين', render: (row) => <Money v={row.debit} /> },
              { key: 'credit', label: 'دائن', render: (row) => <Money v={row.credit} /> },
            ]}
          />
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="قيد يدوي" as="form" onSubmit={submit}
        footer={<><button type="button" className="btn ghost" onClick={() => setOpen(false)}>إلغاء</button><button type="submit" className="btn" disabled={saving || !totals.balanced}>{saving ? 'جارٍ الحفظ…' : 'ترحيل القيد'}</button></>}>
        {formError && <ErrorBar message={formError} />}
          <Input label="التاريخ" type="date" value={form.entry_date} ltr onChange={(e) => setForm((f) => ({ ...f, entry_date: e.target.value }))} />
          <TextArea label="الوصف" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          {formLines.map((line, index) => (
            <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <Select label="الحساب" className="field" value={line.account_code} onChange={(e) => updateLine(index, { account_code: e.target.value })} options={[
                { value: '', label: '— اختر —' },
                ...accounts.filter((a) => !a.is_system || a.linked_bank_account_id || !['1000', '2000', '3000', '4000', '5000', '1100', '5300', '1102'].includes(a.code)).map((a) => ({ value: a.code, label: `${a.code} — ${a.name_ar}` })),
              ]} />
              <Input label="مدين" type="number" step="0.01" value={line.debit} ltr onChange={(e) => updateLine(index, { debit: e.target.value, credit: e.target.value ? '' : line.credit })} />
              <Input label="دائن" type="number" step="0.01" value={line.credit} ltr onChange={(e) => updateLine(index, { credit: e.target.value, debit: e.target.value ? '' : line.debit })} />
            </div>
          ))}
          <button type="button" className="btn ghost sm" onClick={() => setFormLines((prev) => [...prev, { ...EMPTY_LINE }])}>+ سطر</button>
          <p style={{ fontSize: 13, color: totals.balanced ? 'var(--muted)' : 'var(--neg)' }}>
            مدين: {fmtMoney(totals.debit)} ⃁ — دائن: {fmtMoney(totals.credit)} ⃁ {!totals.balanced && '(غير متوازن)'}
          </p>
      </Modal>
    </>
  );
}
