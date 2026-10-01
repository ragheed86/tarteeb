'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getCompanyExpenses, createCompanyExpense, updateCompanyExpense, removeCompanyExpense,
  getCompanyExpenseBudgets, saveCompanyExpenseBudget, uploadCompanyExpenseReceipt,
  getCompanyExpenseReceiptUrl, removeCompanyExpenseReceipt,
  getProjects, getEmployees, getSuppliers, getBankAccounts,
} from '@/lib/data';
import { toCSV, downloadBlob } from '@/lib/dataio';
import { fmtMoney, fmtNum } from '@/lib/format';
import { Loading, Empty, ErrorBar, Modal, DataTable, Input, Select, TextArea, Money, DateText, StatusPill, KpiCard } from '@/components';
import { toast } from '@/app/toast';

const CATEGORIES = {
  software: 'برامج واشتراكات', hosting: 'استضافة ودومينات', equipment: 'أجهزة ومعدات', office: 'مكتب',
  marketing: 'تسويق', payroll: 'رواتب ومكافآت', legal: 'قانوني ومحاسبي', maintenance: 'صيانة', other: 'أخرى',
};
const PAYMENT = { paid: { label: 'مدفوع', cls: 'p-done' }, pending: { label: 'معلّق', cls: 'p-wait' } };
const PAYMENT_METHOD = {
  bank_transfer: 'تحويل بنكي',
  card: 'بطاقة',
  mada: 'مدى',
  cash: 'نقداً',
  stc_pay: 'STC Pay',
  apple_pay: 'Apple Pay',
  other: 'أخرى',
};
const RECURRENCE = { none: 'غير متكرر', monthly: 'شهري', yearly: 'سنوي' };
const NATURE = { fixed: 'ثابت', variable: 'متغير', project: 'متعلق بمشروع' };
const SOURCE = { manual: 'إدخال يدوي', bank_reconciliation: 'المطابقة البنكية', import: 'استيراد' };
const MAX_RECEIPT_SIZE = 6 * 1024 * 1024;
const today = () => new Date().toISOString().slice(0, 10);
const EMPTY_FORM = { description: '', category: 'software', cost_nature: 'variable', project_id: '', employee_id: '', supplier_id: '', vendor: '', account_id: '', amount: '', vat_amount: '0', expense_date: today(), payment_status: 'paid', paid_by: '', payment_method: 'bank_transfer', recurrence: 'none', note: '' };
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const amt = (r) => Number(r.amount || 0);
const fileSize = (bytes) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} ك.ب` : `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;

export default function CompanyExpensesPage() {
  const [rows, setRows] = useState(null);
  const [budgets, setBudgets] = useState([]);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState({ month: today().slice(0, 7), category: 'all', status: 'all', nature: 'all', project: 'all', q: '' });
  const [refs, setRefs] = useState({ projects: [], employees: [], suppliers: [], accounts: [] });
  const [reportOpen, setReportOpen] = useState(false);
  const [reportYear, setReportYear] = useState(today().slice(0, 4));
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptPreview, setReceiptPreview] = useState('');
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const receiptFileRef = useRef(null);
  const receiptCameraRef = useRef(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetForm, setBudgetForm] = useState({ amount: '', alert_percent: '80' });
  const [receiptViewer, setReceiptViewer] = useState(null);

  async function load() {
    try {
      const [expenses, budgetRows, projects, employees, suppliers, accounts] = await Promise.all([
        getCompanyExpenses(), getCompanyExpenseBudgets(),
        getProjects().catch(() => []), getEmployees().catch(() => []),
        getSuppliers().catch(() => []), getBankAccounts().catch(() => []),
      ]);
      setRows(expenses); setBudgets(budgetRows);
      setRefs({ projects: projects || [], employees: employees || [], suppliers: suppliers || [], accounts: (accounts || []).filter((a) => a.active !== false) });
    } catch (e) { setErr(e.message || 'تعذّر تحميل مصاريف الشركة'); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => () => { if (receiptPreview) URL.revokeObjectURL(receiptPreview); }, [receiptPreview]);

  const names = useMemo(() => ({
    project: Object.fromEntries(refs.projects.map((p) => [p.id, p.title])),
    employee: Object.fromEntries(refs.employees.map((e) => [e.id, e.name])),
    supplier: Object.fromEntries(refs.suppliers.map((s) => [s.id, s.name])),
    account: Object.fromEntries(refs.accounts.map((a) => [a.id, a.last_four ? `${a.name} •${a.last_four}` : a.name])),
  }), [refs]);
  const vendorOf = (r) => names.supplier[r.supplier_id] || r.vendor || '';

  const filtered = useMemo(() => (rows || []).filter((r) => {
    const q = filter.q.trim().toLowerCase();
    return (!filter.month || r.expense_date?.startsWith(filter.month))
      && (filter.category === 'all' || r.category === filter.category)
      && (filter.status === 'all' || r.payment_status === filter.status)
      && (filter.nature === 'all' || (r.cost_nature || 'variable') === filter.nature)
      && (filter.project === 'all' || (filter.project === 'none' ? !r.project_id : r.project_id === filter.project))
      && (!q || `${r.description} ${vendorOf(r)} ${r.paid_by || ''} ${PAYMENT_METHOD[r.payment_method] || ''} ${names.project[r.project_id] || ''} ${names.employee[r.employee_id] || ''} ${r.note || ''}`.toLowerCase().includes(q));
  }), [rows, filter, names]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = filtered.reduce((s, r) => s + Number(r.amount || 0), 0);
  const vat = filtered.reduce((s, r) => s + Number(r.vat_amount || 0), 0);
  const pending = filtered.filter((r) => r.payment_status === 'pending').reduce((s, r) => s + Number(r.amount || 0), 0);
  const monthBudget = budgets.find((b) => b.month?.slice(0, 7) === filter.month);
  const budgetPct = monthBudget ? Math.round((total / Number(monthBudget.amount)) * 100) : 0;

  const report = useMemo(() => {
    const yearRows = (rows || []).filter((r) => r.expense_date?.startsWith(reportYear) && (filter.status === 'all' || r.payment_status === filter.status));
    const months = MONTHS.map((label, i) => {
      const key = `${reportYear}-${String(i + 1).padStart(2, '0')}`;
      const list = yearRows.filter((r) => r.expense_date.startsWith(key));
      const by = (n) => list.filter((r) => (r.cost_nature || 'variable') === n).reduce((s, r) => s + amt(r), 0);
      return { key, label, fixed: by('fixed'), variable: by('variable'), project: by('project'), vat: list.reduce((s, r) => s + Number(r.vat_amount || 0), 0), total: list.reduce((s, r) => s + amt(r), 0), count: list.length };
    });
    const group = (list, keyOf, labelOf) => {
      const map = new Map();
      for (const r of list) { const k = keyOf(r); const x = map.get(k) || { label: labelOf(r), total: 0, count: 0 }; x.total += amt(r); x.count += 1; map.set(k, x); }
      const sumAll = list.reduce((s, r) => s + amt(r), 0);
      return [...map.values()].sort((a, b) => b.total - a.total).map((x) => ({ ...x, share: sumAll ? Math.round((x.total / sumAll) * 100) : 0 }));
    };
    return {
      months, yearTotal: months.reduce((s, m) => s + m.total, 0),
      byCategory: group(yearRows, (r) => r.category, (r) => CATEGORIES[r.category] || 'أخرى'),
      byProject: group(yearRows.filter((r) => r.project_id), (r) => r.project_id, (r) => names.project[r.project_id] || 'مشروع محذوف'),
    };
  }, [rows, reportYear, filter.status, names]);

  function exportCSV() {
    const columns = [
      { k: 'expense_date', label: 'التاريخ' }, { k: 'description', label: 'المصروف' }, { k: 'category', label: 'التصنيف' },
      { k: 'nature', label: 'النوع' }, { k: 'project', label: 'المشروع' }, { k: 'employee', label: 'الموظف' },
      { k: 'vendor', label: 'المورد' }, { k: 'amount', label: 'الإجمالي' }, { k: 'vat_amount', label: 'الضريبة' },
      { k: 'net', label: 'قبل الضريبة' }, { k: 'status', label: 'حالة الدفع' }, { k: 'method', label: 'طريقة الدفع' },
      { k: 'account', label: 'الحساب' }, { k: 'paid_by', label: 'الدافع' }, { k: 'source', label: 'المصدر' },
      { k: 'receipt', label: 'مستند' }, { k: 'note', label: 'ملاحظات' },
    ];
    const data = filtered.map((r) => ({
      expense_date: r.expense_date, description: r.description, category: CATEGORIES[r.category] || 'أخرى',
      nature: NATURE[r.cost_nature] || NATURE.variable, project: names.project[r.project_id] || '', employee: names.employee[r.employee_id] || '',
      vendor: vendorOf(r), amount: amt(r).toFixed(2), vat_amount: Number(r.vat_amount || 0).toFixed(2), net: (amt(r) - Number(r.vat_amount || 0)).toFixed(2),
      status: PAYMENT[r.payment_status]?.label || '', method: PAYMENT_METHOD[r.payment_method] || '', account: names.account[r.account_id] || '',
      paid_by: r.paid_by || '', source: SOURCE[r.source] || SOURCE.manual, receipt: r.receipt_path ? 'نعم' : 'لا', note: r.note || '',
    }));
    downloadBlob(toCSV(data, columns), `tarteeb-expenses-${filter.month || 'all'}.csv`, 'text/csv;charset=utf-8');
    toast(`تم تصدير ${fmtNum(data.length)} مصروف`);
  }

  function setF(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function resetReceipt() { setReceiptFile(null); setReceiptPreview(''); setRemoveReceipt(false); }
  function closeForm() { if (!saving) { setOpen(false); resetReceipt(); } }
  function add() { setEditing(null); setForm({ ...EMPTY_FORM, expense_date: today() }); setFormErr(''); resetReceipt(); setOpen(true); }
  function edit(r) {
    resetReceipt();
    setEditing(r); setForm({
      description: r.description || '', category: r.category || 'other', vendor: r.vendor || '', amount: String(r.amount || ''),
      cost_nature: r.cost_nature || 'variable', project_id: r.project_id || '', employee_id: r.employee_id || '',
      supplier_id: r.supplier_id || '', account_id: r.account_id || '',
      vat_amount: String(r.vat_amount || 0), expense_date: r.expense_date || today(), payment_status: r.payment_status || 'paid',
      paid_by: r.paid_by || '', payment_method: r.payment_method || 'bank_transfer', recurrence: r.recurrence || 'none', note: r.note || '',
    }); setFormErr(''); setOpen(true);
  }
  function chooseReceipt(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!(file.type.startsWith('image/') || file.type === 'application/pdf')) { setFormErr('يمكن إرفاق صورة أو ملف PDF فقط'); return; }
    if (file.size > MAX_RECEIPT_SIZE) { setFormErr('حجم الفاتورة يجب ألا يتجاوز 6 ميجابايت'); return; }
    setReceiptFile(file); setRemoveReceipt(false); setFormErr('');
    setReceiptPreview(file.type.startsWith('image/') ? URL.createObjectURL(file) : '');
  }
  async function viewReceipt(row) {
    setReceiptViewer({ row, url: '', loading: true });
    try {
      const url = await getCompanyExpenseReceiptUrl(row.receipt_path);
      setReceiptViewer({ row, url, loading: false });
    } catch (e) {
      setReceiptViewer(null);
      toast(e.message || 'تعذّر فتح الفاتورة', 'err');
    }
  }
  async function submit(e) {
    e.preventDefault();
    if (!form.description.trim() || Number(form.amount) <= 0) { setFormErr('أدخل وصف المصروف ومبلغاً صحيحاً'); return; }
    if (Number(form.vat_amount) < 0 || Number(form.vat_amount) > Number(form.amount)) { setFormErr('قيمة الضريبة يجب ألا تتجاوز إجمالي المصروف'); return; }
    if (form.cost_nature === 'project' && !form.project_id) { setFormErr('اختر المشروع المرتبط بهذا المصروف'); return; }
    setSaving(true); setFormErr('');
    const expenseId = editing?.id || crypto.randomUUID();
    let uploadedReceipt = null;
    try {
      if (receiptFile) uploadedReceipt = await uploadCompanyExpenseReceipt(expenseId, receiptFile);
      const receiptPatch = uploadedReceipt || (removeReceipt ? { receipt_path: null, receipt_name: null, receipt_type: null, receipt_size: null } : {});
      const payload = {
        ...form, ...receiptPatch, ...(!editing ? { id: expenseId } : {}),
        description: form.description.trim(), note: form.note.trim() || null,
        vendor: (form.supplier_id ? names.supplier[form.supplier_id] : form.vendor.trim()) || null,
        project_id: form.project_id || null, employee_id: form.employee_id || null,
        supplier_id: form.supplier_id || null, account_id: form.account_id || null,
        paid_by: form.paid_by.trim() || null, payment_method: form.payment_method || null,
        amount: Number(form.amount), vat_amount: Number(form.vat_amount) || 0,
      };
      const saved = editing ? await updateCompanyExpense(editing.id, payload) : await createCompanyExpense(payload);
      setRows((all) => editing ? all.map((r) => r.id === saved.id ? saved : r) : [saved, ...all]);
      // الفاتورة القديمة (إن استُبدلت أو أُزيلت) تُحذف تلقائياً عبر طابور التنظيف
      setOpen(false); resetReceipt(); toast(editing ? 'تم تحديث المصروف' : 'تمت إضافة المصروف');
    } catch (e2) {
      if (uploadedReceipt?.receipt_path) removeCompanyExpenseReceipt(uploadedReceipt.receipt_path).catch(() => {});
      setFormErr(e2.message || 'تعذّر الحفظ');
    }
    finally { setSaving(false); }
  }
  async function del(r) {
    if (!confirm(`حذف مصروف «${r.description}»؟`)) return;
    try {
      await removeCompanyExpense(r.id);
      setRows((all) => all.filter((x) => x.id !== r.id)); toast('تم حذف المصروف');
    }
    catch (e) { toast(e.message || 'تعذّر الحذف', 'err'); }
  }
  function openBudget() {
    setBudgetForm({ amount: String(monthBudget?.amount || ''), alert_percent: String(monthBudget?.alert_percent || 80) });
    setBudgetOpen(true);
  }
  async function submitBudget(e) {
    e.preventDefault();
    if (Number(budgetForm.amount) <= 0) return;
    setSaving(true);
    try {
      const saved = await saveCompanyExpenseBudget(`${filter.month}-01`, Number(budgetForm.amount), Number(budgetForm.alert_percent) || 80);
      setBudgets((all) => [saved, ...all.filter((b) => b.id !== saved.id)]); setBudgetOpen(false); toast('تم حفظ ميزانية الشهر');
    } catch (e2) { toast(e2.message || 'تعذّر حفظ الميزانية', 'err'); }
    finally { setSaving(false); }
  }

  if (err) return <ErrorBar message={err} />;
  if (!rows) return <Loading />;
  const alerting = monthBudget && budgetPct >= Number(monthBudget.alert_percent);

  return (
    <>
      <style>{CSS}</style>
      <div className="sec-head expense-head">
        <div><h2>مصاريف الشركة</h2><p>سجل موحّد لكل مصاريف ترتيب — الثابتة والمتغيرة والمرتبطة بالمشاريع</p></div>
        <div className="head-actions">
          <button className="btn ghost" onClick={() => setReportOpen(true)}>التقرير الشهري</button>
          <button className="btn ghost" onClick={exportCSV} disabled={!filtered.length}>تصدير</button>
          <button className="btn" onClick={add}>+ مصروف جديد</button>
        </div>
      </div>

      {alerting && <div className={`expense-alert${budgetPct >= 100 ? ' danger' : ''}`}>بلغ الصرف {fmtNum(budgetPct)}% من ميزانية هذا الشهر.</div>}
      <div className="kpis expense-kpis">
        <KpiCard label="إجمالي الفترة" value={`${fmtMoney(total)} ⃁`} trend={`${fmtNum(filtered.length)} مصروف`} definition="مجموع المصاريف التي تطابق الشهر والتصنيف وحالة الدفع والبحث المحدد حاليًا." period={filter.month || 'كل الفترات'} formula="جمع إجمالي المصاريف الظاهرة بعد الفلترة" breakdown={Object.entries(CATEGORIES).map(([key, label]) => ({ label, value: filtered.filter((r) => r.category === key).reduce((s, r) => s + Number(r.amount || 0), 0) })).filter((x) => x.value > 0).map((x) => ({ label: x.label, value: `${fmtMoney(x.value)} ⃁` }))} />
        <KpiCard label="الضريبة القابلة للتتبع" value={`${fmtMoney(vat)} ⃁`} trend="ضمن الإجمالي" definition="مجموع مبالغ الضريبة المدخلة داخل المصاريف الظاهرة حاليًا." period={filter.month || 'كل الفترات'} formula="جمع حقل مبلغ الضريبة لكل مصروف ظاهر" note="هذا المؤشر للتتبع الداخلي، ولا يُعد إقرارًا ضريبيًا." />
        <KpiCard tone="alert" label="مبالغ معلّقة" value={`${fmtMoney(pending)} ⃁`} trend="لم تُدفع بعد" definition="إجمالي المصاريف الظاهرة التي ما زالت حالة دفعها «معلّق»." period={filter.month || 'كل الفترات'} formula="جمع المصاريف المعلّقة بعد تطبيق الفلاتر" breakdown={filtered.filter((r) => r.payment_status === 'pending').slice(0, 6).map((r) => ({ label: r.description, value: `${fmtMoney(r.amount)} ⃁` }))} />
        <KpiCard label="ميزانية الشهر" value={monthBudget ? `${fmtMoney(monthBudget.amount)} ⃁` : '—'} trend={monthBudget ? `المستخدم ${fmtNum(budgetPct)}%` : 'اضغط للتفاصيل'} definition="سقف الإنفاق الذي حددته لمصاريف الشركة في الشهر المختار." period={filter.month} formula="نسبة الاستخدام = إجمالي مصاريف الفترة ÷ الميزانية × 100" breakdown={[{ label: 'الميزانية', value: monthBudget ? `${fmtMoney(monthBudget.amount)} ⃁` : 'غير محددة' }, { label: 'المصروف', value: `${fmtMoney(total)} ⃁` }, { label: 'نسبة الاستخدام', value: monthBudget ? `${fmtNum(budgetPct)}%` : '—' }]} actionLabel={monthBudget ? 'تعديل الميزانية' : 'تحديد الميزانية'} onAction={openBudget} />
      </div>

      <div className="card expense-filters">
        <Input label="الشهر" type="month" ltr value={filter.month} onChange={(e) => setFilter((f) => ({ ...f, month: e.target.value }))} />
        <Select label="التصنيف" value={filter.category} onChange={(e) => setFilter((f) => ({ ...f, category: e.target.value }))} options={[{ value: 'all', label: 'كل التصنيفات' }, ...Object.entries(CATEGORIES).map(([value, label]) => ({ value, label }))]} />
        <Select label="حالة الدفع" value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))} options={[{ value: 'all', label: 'كل الحالات' }, { value: 'paid', label: 'مدفوع' }, { value: 'pending', label: 'معلّق' }]} />
        <Select label="النوع" value={filter.nature} onChange={(e) => setFilter((f) => ({ ...f, nature: e.target.value }))} options={[{ value: 'all', label: 'كل الأنواع' }, ...Object.entries(NATURE).map(([value, label]) => ({ value, label }))]} />
        <Select label="المشروع" value={filter.project} onChange={(e) => setFilter((f) => ({ ...f, project: e.target.value }))} options={[{ value: 'all', label: 'كل المصاريف' }, { value: 'none', label: 'غير مرتبط بمشروع' }, ...refs.projects.map((p) => ({ value: p.id, label: p.title }))]} />
        <Input label="بحث" value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))} placeholder="الوصف، المورد، المشروع أو الموظف" />
      </div>

      <div className="card" style={{ padding: '6px 0' }}>
        <DataTable rows={filtered} empty={<Empty title="لا توجد مصاريف" desc="أضف أول مصروف عام أو غيّر الفلاتر." />} columns={[
          { key: 'description', label: 'المصروف', primary: true, render: (r) => <><span className="nm">{r.description}</span>{vendorOf(r) && <><br /><small>{vendorOf(r)}</small></>}{r.receipt_path && <button type="button" className="receipt-link" onClick={() => viewReceipt(r)}>▣ عرض الفاتورة</button>}</> },
          { key: 'category', label: 'التصنيف', render: (r) => <div className="payment-cell"><span>{CATEGORIES[r.category] || 'أخرى'}</span><small>{NATURE[r.cost_nature] || NATURE.variable}</small></div> },
          { key: 'link', label: 'مرتبط بـ', render: (r) => (r.project_id || r.employee_id) ? <div className="payment-cell">{r.project_id && <span>{names.project[r.project_id] || 'مشروع'}</span>}{r.employee_id && <small>{names.employee[r.employee_id] || 'موظف'}</small>}</div> : '—' },
          { key: 'expense_date', label: 'التاريخ', render: (r) => <DateText v={r.expense_date} /> },
          { key: 'amount', label: 'الإجمالي', render: (r) => <Money v={r.amount} /> },
          { key: 'paid_by', label: 'المصدر', render: (r) => <div className="payment-cell"><span>{names.account[r.account_id] || r.paid_by || '—'}</span><small>{SOURCE[r.source] || SOURCE.manual}</small></div> },
          { key: 'payment_status', label: 'الدفع', render: (r) => <div className="payment-cell"><StatusPill status={r.payment_status} map={PAYMENT} /><small>{PAYMENT_METHOD[r.payment_method] || '—'}</small></div> },
          { key: 'recurrence', label: 'التكرار', render: (r) => RECURRENCE[r.recurrence] || '—' },
          { key: 'actions', label: '', align: 'left', render: (r) => <div className="row-actions"><button className="btn ghost sm" onClick={() => edit(r)}>تعديل</button><button className="btn ghost sm danger-text" onClick={() => del(r)}>حذف</button></div> },
        ]} />
      </div>

      <Modal open={open} onClose={closeForm} title={editing ? 'تعديل المصروف' : 'مصروف جديد'} subtitle="كل مصروف يُسجَّل هنا مرة واحدة ويظهر تلقائياً في التقارير" as="form" onSubmit={submit} footer={<><button type="button" className="btn ghost" onClick={closeForm} disabled={saving}>إلغاء</button><button className="btn" disabled={saving}>{saving ? 'جارٍ الحفظ…' : receiptFile ? 'حفظ ورفع الفاتورة' : 'حفظ المصروف'}</button></>}>
        {formErr && <div className="errbar">{formErr}</div>}
        <div className="form-grid">
          <Input className="span-2" label="وصف المصروف" value={form.description} onChange={(e) => setF('description', e.target.value)} required autoFocus />
          <Select label="التصنيف" value={form.category} onChange={(e) => setF('category', e.target.value)} options={Object.entries(CATEGORIES).map(([value, label]) => ({ value, label }))} />
          <Select label="نوع المصروف" value={form.cost_nature} onChange={(e) => setF('cost_nature', e.target.value)} options={Object.entries(NATURE).map(([value, label]) => ({ value, label }))} />
          <Select label={form.cost_nature === 'project' ? 'المشروع (مطلوب)' : 'المشروع (اختياري)'} value={form.project_id} onChange={(e) => setF('project_id', e.target.value)} options={[{ value: '', label: '— بدون مشروع —' }, ...refs.projects.map((p) => ({ value: p.id, label: p.title }))]} />
          <Select label="الموظف (اختياري)" value={form.employee_id} onChange={(e) => setF('employee_id', e.target.value)} options={[{ value: '', label: '— بدون موظف —' }, ...refs.employees.map((x) => ({ value: x.id, label: x.name }))]} />
          <Select label="المورد" value={form.supplier_id} onChange={(e) => setF('supplier_id', e.target.value)} options={[{ value: '', label: refs.suppliers.length ? '— مورد غير مسجّل —' : '— لا يوجد موردون —' }, ...refs.suppliers.map((s) => ({ value: s.id, label: s.name }))]} />
          {!form.supplier_id && <Input label="اسم المورد" value={form.vendor} onChange={(e) => setF('vendor', e.target.value)} placeholder="إذا لم يكن من قائمة الموردين" />}
          <Input label="الإجمالي (شامل الضريبة)" type="number" min="0.01" step="0.01" ltr value={form.amount} onChange={(e) => setF('amount', e.target.value)} required />
          <Input label="مبلغ الضريبة" type="number" min="0" step="0.01" ltr value={form.vat_amount} onChange={(e) => setF('vat_amount', e.target.value)} />
          <Input label="تاريخ المصروف" type="date" ltr value={form.expense_date} onChange={(e) => setF('expense_date', e.target.value)} required />
          <Select label="حالة الدفع" value={form.payment_status} onChange={(e) => setF('payment_status', e.target.value)} options={Object.entries(PAYMENT).map(([value, x]) => ({ value, label: x.label }))} />
          <Input label="مين دفع؟" value={form.paid_by} onChange={(e) => setF('paid_by', e.target.value)} placeholder="مثلاً: رغيد / دلال / زين" />
          <Select label="طريقة الدفع" value={form.payment_method} onChange={(e) => setF('payment_method', e.target.value)} options={Object.entries(PAYMENT_METHOD).map(([value, label]) => ({ value, label }))} />
          <Select label="الحساب المستخدم" value={form.account_id} onChange={(e) => setF('account_id', e.target.value)} options={[{ value: '', label: '— نقدي / شخصي —' }, ...refs.accounts.map((a) => ({ value: a.id, label: names.account[a.id] }))]} />
          <Select label="التكرار" value={form.recurrence} onChange={(e) => setF('recurrence', e.target.value)} options={Object.entries(RECURRENCE).map(([value, label]) => ({ value, label }))} />
          <div className="field span-2 receipt-field">
            <label>فاتورة أو إيصال <span className="optional">(اختياري)</span></label>
            <div className="receipt-actions">
              <button type="button" className="btn ghost sm" disabled={saving} onClick={() => receiptFileRef.current?.click()}>▣ اختيار صورة أو PDF</button>
              <input ref={receiptFileRef} id="expense-receipt-file" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" hidden disabled={saving} onChange={chooseReceipt} />
              <button type="button" className="btn ghost sm camera-btn" disabled={saving} onClick={() => receiptCameraRef.current?.click()}>◎ تصوير الفاتورة</button>
              <input ref={receiptCameraRef} id="expense-receipt-camera" type="file" accept="image/*" capture="environment" hidden disabled={saving} onChange={chooseReceipt} />
            </div>
            <small className="receipt-hint">الصور وملفات PDF حتى 6 ميجابايت. التصوير يفتح الكاميرا الخلفية على الجوال.</small>

            {receiptFile && <div className="receipt-selected">
              {receiptPreview ? <img src={receiptPreview} alt="معاينة الفاتورة المختارة" /> : <div className="receipt-file-icon">PDF</div>}
              <div><b>{receiptFile.name}</b><span>{fileSize(receiptFile.size)}</span></div>
              <button type="button" className="btn ghost sm danger-text" onClick={resetReceipt}>إزالة</button>
            </div>}

            {!receiptFile && editing?.receipt_path && !removeReceipt && <div className="receipt-selected existing">
              <div className="receipt-file-icon">▣</div>
              <div><b>{editing.receipt_name || 'الفاتورة المرفقة'}</b><span>{editing.receipt_size ? fileSize(editing.receipt_size) : 'مرفق محفوظ'}</span></div>
              <button type="button" className="btn ghost sm" onClick={() => viewReceipt(editing)}>فتح</button>
              <button type="button" className="btn ghost sm danger-text" onClick={() => setRemoveReceipt(true)}>إزالة</button>
            </div>}

            {!receiptFile && removeReceipt && <div className="receipt-remove-note">ستتم إزالة الفاتورة الحالية عند الحفظ. <button type="button" onClick={() => setRemoveReceipt(false)}>تراجع</button></div>}
          </div>
          <TextArea className="span-2" label="ملاحظات" value={form.note} onChange={(e) => setF('note', e.target.value)} rows="3" />
        </div>
      </Modal>

      <Modal open={budgetOpen} onClose={() => setBudgetOpen(false)} title="ميزانية مصاريف الشهر" subtitle={filter.month} as="form" onSubmit={submitBudget} size="sm" footer={<><button type="button" className="btn ghost" onClick={() => setBudgetOpen(false)}>إلغاء</button><button className="btn" disabled={saving}>حفظ</button></>}>
        <Input label="الميزانية" type="number" min="1" step="0.01" ltr value={budgetForm.amount} onChange={(e) => setBudgetForm((f) => ({ ...f, amount: e.target.value }))} required />
        <Input label="التنبيه عند (%)" type="number" min="1" max="100" ltr value={budgetForm.alert_percent} onChange={(e) => setBudgetForm((f) => ({ ...f, alert_percent: e.target.value }))} required />
      </Modal>

      <Modal open={reportOpen} onClose={() => setReportOpen(false)} title="التقرير الشهري للمصاريف" subtitle={`سنة ${reportYear}${filter.status !== 'all' ? ` · ${PAYMENT[filter.status].label} فقط` : ''}`} size="lg" footer={<button type="button" className="btn ghost" onClick={() => setReportOpen(false)}>إغلاق</button>}>
        <div className="report-toolbar">
          <Input label="السنة" type="number" min="2020" max="2100" ltr value={reportYear} onChange={(e) => setReportYear(e.target.value)} />
          <div className="report-total"><small>إجمالي السنة</small><b>{fmtMoney(report.yearTotal)} ⃁</b></div>
        </div>
        <h4 className="report-h">حسب الشهر والنوع</h4>
        <div className="report-scroll"><table className="report-table">
          <thead><tr><th>الشهر</th><th>ثابت</th><th>متغير</th><th>مشاريع</th><th>الضريبة</th><th>الإجمالي</th></tr></thead>
          <tbody>{report.months.map((m) => <tr key={m.key} className={m.count ? '' : 'muted'}><td>{m.label}</td><td>{fmtMoney(m.fixed)}</td><td>{fmtMoney(m.variable)}</td><td>{fmtMoney(m.project)}</td><td>{fmtMoney(m.vat)}</td><td><b>{fmtMoney(m.total)}</b></td></tr>)}</tbody>
        </table></div>
        <div className="report-split">
          <div><h4 className="report-h">حسب التصنيف</h4>
            {report.byCategory.length ? <table className="report-table"><tbody>{report.byCategory.map((x) => <tr key={x.label}><td>{x.label}</td><td>{fmtMoney(x.total)}</td><td className="share">{fmtNum(x.share)}%</td></tr>)}</tbody></table> : <p className="report-empty">لا توجد مصاريف</p>}
          </div>
          <div><h4 className="report-h">حسب المشروع</h4>
            {report.byProject.length ? <table className="report-table"><tbody>{report.byProject.map((x) => <tr key={x.label}><td>{x.label}</td><td>{fmtMoney(x.total)}</td><td className="share">{fmtNum(x.count)} مصروف</td></tr>)}</tbody></table> : <p className="report-empty">لا توجد مصاريف مرتبطة بمشاريع</p>}
          </div>
        </div>
      </Modal>

      <Modal
        open={!!receiptViewer}
        onClose={() => setReceiptViewer(null)}
        title="فاتورة المصروف"
        subtitle={receiptViewer?.row?.receipt_name || receiptViewer?.row?.description}
        size="lg"
        className="receipt-view-modal"
        footer={<><button type="button" className="btn ghost" onClick={() => setReceiptViewer(null)}>إغلاق</button>{receiptViewer?.url && <a className="btn" href={receiptViewer.url} target="_blank" rel="noreferrer">فتح في تبويب</a>}</>}
      >
        {!receiptViewer || receiptViewer.loading ? (
          <Loading />
        ) : receiptViewer.row?.receipt_type?.startsWith('image/') ? (
          <div className="receipt-preview-box"><img src={receiptViewer.url} alt={receiptViewer.row?.receipt_name || 'فاتورة المصروف'} /></div>
        ) : (
          <iframe className="receipt-pdf-frame" src={receiptViewer.url} title={receiptViewer.row?.receipt_name || 'فاتورة المصروف'} />
        )}
      </Modal>
    </>
  );
}

const CSS = `
.expense-head{margin-bottom:18px;align-items:flex-end}.expense-head h2{margin:0}.expense-head p{margin:5px 0 0;color:var(--muted);font-size:13px}
.expense-kpis{grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:16px}.expense-filters{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin-bottom:14px;padding:14px}.expense-filters .field{margin:0}
.head-actions{display:flex;gap:8px;flex-wrap:wrap}
.report-toolbar{display:flex;gap:16px;align-items:flex-end;justify-content:space-between;margin-bottom:6px}.report-toolbar .field{margin:0;max-width:140px}.report-total{text-align:left}.report-total small{display:block;color:var(--muted);font-size:12px}.report-total b{font-size:20px}
.report-h{margin:16px 0 8px;font-size:14px}.report-scroll{overflow-x:auto}.report-table{width:100%;border-collapse:collapse;font-size:13px}.report-table th,.report-table td{padding:7px 9px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}.report-table th{color:var(--muted);font-weight:600;font-size:12px}.report-table tr.muted td{color:var(--muted)}.report-table .share{color:var(--muted);text-align:left}
.report-split{display:grid;grid-template-columns:1fr 1fr;gap:18px}.report-empty{color:var(--muted);font-size:13px}
.expense-alert{margin-bottom:14px;padding:11px 15px;border-radius:11px;background:var(--gold-bg);color:#725821;font-size:13px}.expense-alert.danger{background:var(--neg-bg);color:var(--neg)}
.link-btn{border:0;background:none;color:var(--green);padding:0;cursor:pointer;font:inherit}.row-actions{display:flex;gap:6px;justify-content:flex-end}.danger-text{color:var(--neg)!important}.payment-cell{display:grid;gap:4px}.payment-cell small{color:var(--muted);font-size:11.5px}
.receipt-link{display:block;border:0;background:none;color:var(--green);font:inherit;font-size:11.5px;padding:4px 0 0;cursor:pointer}.receipt-field{border:1px solid var(--line);border-radius:12px;padding:13px;background:var(--surface-2)}.receipt-field>label{display:block;font-size:13px;font-weight:600;margin-bottom:9px}.receipt-field .optional{font-weight:400;color:var(--muted)}.receipt-actions{display:flex;gap:8px;flex-wrap:wrap}.receipt-hint{display:block;color:var(--muted);font-size:11.5px;line-height:1.6;margin-top:7px}.camera-btn{color:var(--green)!important;border-color:rgba(14,126,130,.3)!important}.receipt-selected{display:grid;grid-template-columns:54px minmax(0,1fr) auto;align-items:center;gap:10px;margin-top:11px;padding:9px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}.receipt-selected.existing{grid-template-columns:42px minmax(0,1fr) auto auto}.receipt-selected img{width:54px;height:54px;border-radius:8px;object-fit:cover}.receipt-selected b{display:block;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.receipt-selected span{display:block;color:var(--muted);font-size:11px;margin-top:3px}.receipt-file-icon{width:42px;height:42px;border-radius:8px;display:grid;place-items:center;background:var(--sage-bg);color:var(--green);font-size:11px;font-weight:700}.receipt-remove-note{margin-top:10px;border-radius:9px;padding:9px 11px;background:var(--neg-bg);color:var(--neg);font-size:12px}.receipt-remove-note button{border:0;background:none;color:inherit;text-decoration:underline;cursor:pointer;font:inherit;font-weight:600}
.receipt-view-modal{width:min(920px,calc(100vw - 28px))!important}.receipt-preview-box{border:1px solid var(--line);border-radius:14px;background:var(--surface-2);padding:10px;display:grid;place-items:center;min-height:50vh}.receipt-preview-box img{max-width:100%;max-height:72vh;border-radius:10px;object-fit:contain}.receipt-pdf-frame{width:100%;height:min(72vh,760px);border:1px solid var(--line);border-radius:14px;background:#fff}
@media(max-width:1100px){.expense-filters{grid-template-columns:repeat(3,1fr)}}
@media(max-width:900px){.expense-kpis{grid-template-columns:repeat(2,1fr)}.expense-filters{grid-template-columns:repeat(2,1fr)}.report-split{grid-template-columns:1fr}}
@media(max-width:580px){.expense-head{align-items:flex-start}.expense-kpis,.expense-filters{grid-template-columns:1fr}.receipt-actions .btn{flex:1;justify-content:center}.receipt-selected,.receipt-selected.existing{grid-template-columns:46px minmax(0,1fr)}.receipt-selected .btn{grid-column:1/-1;justify-content:center}.receipt-selected img{width:46px;height:46px}}
`;
