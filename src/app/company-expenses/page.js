'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  getCompanyExpenses, createCompanyExpense, updateCompanyExpense, removeCompanyExpense,
  getCompanyExpenseBudgets, saveCompanyExpenseBudget,
} from '@/lib/data';
import { fmtMoney, fmtNum } from '@/lib/format';
import { Loading, Empty, ErrorBar, Modal, DataTable, Input, Select, TextArea, Money, DateText, StatusPill, KpiCard } from '@/components';
import { toast } from '@/app/toast';

const CATEGORIES = {
  software: 'برامج واشتراكات', hosting: 'استضافة ودومينات', equipment: 'أجهزة ومعدات', office: 'مكتب',
  marketing: 'تسويق', payroll: 'رواتب ومكافآت', legal: 'قانوني ومحاسبي', maintenance: 'صيانة', other: 'أخرى',
};
const PAYMENT = { paid: { label: 'مدفوع', cls: 'p-done' }, pending: { label: 'معلّق', cls: 'p-wait' } };
const RECURRENCE = { none: 'غير متكرر', monthly: 'شهري', yearly: 'سنوي' };
const today = () => new Date().toISOString().slice(0, 10);
const EMPTY_FORM = { description: '', category: 'software', vendor: '', amount: '', vat_amount: '0', expense_date: today(), payment_status: 'paid', recurrence: 'none', note: '' };

export default function CompanyExpensesPage() {
  const [rows, setRows] = useState(null);
  const [budgets, setBudgets] = useState([]);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState({ month: today().slice(0, 7), category: 'all', status: 'all', q: '' });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetForm, setBudgetForm] = useState({ amount: '', alert_percent: '80' });

  async function load() {
    try {
      const [expenses, budgetRows] = await Promise.all([getCompanyExpenses(), getCompanyExpenseBudgets()]);
      setRows(expenses); setBudgets(budgetRows);
    } catch (e) { setErr(e.message || 'تعذّر تحميل مصاريف الشركة'); }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => (rows || []).filter((r) => {
    const q = filter.q.trim().toLowerCase();
    return (!filter.month || r.expense_date?.startsWith(filter.month))
      && (filter.category === 'all' || r.category === filter.category)
      && (filter.status === 'all' || r.payment_status === filter.status)
      && (!q || `${r.description} ${r.vendor || ''} ${r.note || ''}`.toLowerCase().includes(q));
  }), [rows, filter]);

  const total = filtered.reduce((s, r) => s + Number(r.amount || 0), 0);
  const vat = filtered.reduce((s, r) => s + Number(r.vat_amount || 0), 0);
  const pending = filtered.filter((r) => r.payment_status === 'pending').reduce((s, r) => s + Number(r.amount || 0), 0);
  const monthBudget = budgets.find((b) => b.month?.slice(0, 7) === filter.month);
  const budgetPct = monthBudget ? Math.round((total / Number(monthBudget.amount)) * 100) : 0;

  function setF(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function add() { setEditing(null); setForm({ ...EMPTY_FORM, expense_date: today() }); setFormErr(''); setOpen(true); }
  function edit(r) {
    setEditing(r); setForm({
      description: r.description || '', category: r.category || 'other', vendor: r.vendor || '', amount: String(r.amount || ''),
      vat_amount: String(r.vat_amount || 0), expense_date: r.expense_date || today(), payment_status: r.payment_status || 'paid',
      recurrence: r.recurrence || 'none', note: r.note || '',
    }); setFormErr(''); setOpen(true);
  }
  async function submit(e) {
    e.preventDefault();
    if (!form.description.trim() || Number(form.amount) <= 0) { setFormErr('أدخل وصف المصروف ومبلغاً صحيحاً'); return; }
    if (Number(form.vat_amount) < 0 || Number(form.vat_amount) > Number(form.amount)) { setFormErr('قيمة الضريبة يجب ألا تتجاوز إجمالي المصروف'); return; }
    setSaving(true); setFormErr('');
    const payload = { ...form, description: form.description.trim(), vendor: form.vendor.trim() || null, note: form.note.trim() || null, amount: Number(form.amount), vat_amount: Number(form.vat_amount) || 0 };
    try {
      const saved = editing ? await updateCompanyExpense(editing.id, payload) : await createCompanyExpense(payload);
      setRows((all) => editing ? all.map((r) => r.id === saved.id ? saved : r) : [saved, ...all]);
      setOpen(false); toast(editing ? 'تم تحديث المصروف' : 'تمت إضافة المصروف');
    } catch (e2) { setFormErr(e2.message || 'تعذّر الحفظ'); }
    finally { setSaving(false); }
  }
  async function del(r) {
    if (!confirm(`حذف مصروف «${r.description}»؟`)) return;
    try { await removeCompanyExpense(r.id); setRows((all) => all.filter((x) => x.id !== r.id)); toast('تم حذف المصروف'); }
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
        <div><h2>مصاريف الشركة</h2><p>نفقات التشغيل العامة غير المرتبطة بمشروع محدد</p></div>
        <button className="btn" onClick={add}>+ مصروف جديد</button>
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
        <Input label="بحث" value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))} placeholder="الوصف أو المورد" />
      </div>

      <div className="card" style={{ padding: '6px 0' }}>
        <DataTable rows={filtered} empty={<Empty title="لا توجد مصاريف" desc="أضف أول مصروف عام أو غيّر الفلاتر." />} columns={[
          { key: 'description', label: 'المصروف', primary: true, render: (r) => <><span className="nm">{r.description}</span>{r.vendor && <><br /><small>{r.vendor}</small></>}</> },
          { key: 'category', label: 'التصنيف', render: (r) => CATEGORIES[r.category] || 'أخرى' },
          { key: 'expense_date', label: 'التاريخ', render: (r) => <DateText v={r.expense_date} /> },
          { key: 'amount', label: 'الإجمالي', render: (r) => <Money v={r.amount} /> },
          { key: 'payment_status', label: 'الدفع', render: (r) => <StatusPill status={r.payment_status} map={PAYMENT} /> },
          { key: 'recurrence', label: 'التكرار', render: (r) => RECURRENCE[r.recurrence] || '—' },
          { key: 'actions', label: '', align: 'left', render: (r) => <div className="row-actions"><button className="btn ghost sm" onClick={() => edit(r)}>تعديل</button><button className="btn ghost sm danger-text" onClick={() => del(r)}>حذف</button></div> },
        ]} />
      </div>

      <Modal open={open} onClose={() => !saving && setOpen(false)} title={editing ? 'تعديل المصروف' : 'مصروف شركة جديد'} subtitle="لا تستخدم هذه الصفحة لمصاريف مشروع محدد" as="form" onSubmit={submit} footer={<><button type="button" className="btn ghost" onClick={() => setOpen(false)}>إلغاء</button><button className="btn" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ المصروف'}</button></>}>
        {formErr && <div className="errbar">{formErr}</div>}
        <div className="form-grid">
          <Input className="span-2" label="وصف المصروف" value={form.description} onChange={(e) => setF('description', e.target.value)} required autoFocus />
          <Select label="التصنيف" value={form.category} onChange={(e) => setF('category', e.target.value)} options={Object.entries(CATEGORIES).map(([value, label]) => ({ value, label }))} />
          <Input label="المورد" value={form.vendor} onChange={(e) => setF('vendor', e.target.value)} />
          <Input label="الإجمالي (شامل الضريبة)" type="number" min="0.01" step="0.01" ltr value={form.amount} onChange={(e) => setF('amount', e.target.value)} required />
          <Input label="مبلغ الضريبة" type="number" min="0" step="0.01" ltr value={form.vat_amount} onChange={(e) => setF('vat_amount', e.target.value)} />
          <Input label="تاريخ المصروف" type="date" ltr value={form.expense_date} onChange={(e) => setF('expense_date', e.target.value)} required />
          <Select label="حالة الدفع" value={form.payment_status} onChange={(e) => setF('payment_status', e.target.value)} options={Object.entries(PAYMENT).map(([value, x]) => ({ value, label: x.label }))} />
          <Select label="التكرار" value={form.recurrence} onChange={(e) => setF('recurrence', e.target.value)} options={Object.entries(RECURRENCE).map(([value, label]) => ({ value, label }))} />
          <TextArea className="span-2" label="ملاحظات" value={form.note} onChange={(e) => setF('note', e.target.value)} rows="3" />
        </div>
      </Modal>

      <Modal open={budgetOpen} onClose={() => setBudgetOpen(false)} title="ميزانية مصاريف الشهر" subtitle={filter.month} as="form" onSubmit={submitBudget} size="sm" footer={<><button type="button" className="btn ghost" onClick={() => setBudgetOpen(false)}>إلغاء</button><button className="btn" disabled={saving}>حفظ</button></>}>
        <Input label="الميزانية" type="number" min="1" step="0.01" ltr value={budgetForm.amount} onChange={(e) => setBudgetForm((f) => ({ ...f, amount: e.target.value }))} required />
        <Input label="التنبيه عند (%)" type="number" min="1" max="100" ltr value={budgetForm.alert_percent} onChange={(e) => setBudgetForm((f) => ({ ...f, alert_percent: e.target.value }))} required />
      </Modal>
    </>
  );
}

const CSS = `
.expense-head{margin-bottom:18px;align-items:flex-end}.expense-head h2{margin:0}.expense-head p{margin:5px 0 0;color:var(--muted);font-size:13px}
.expense-kpis{grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:16px}.expense-filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px;padding:14px}.expense-filters .field{margin:0}
.expense-alert{margin-bottom:14px;padding:11px 15px;border-radius:11px;background:var(--gold-bg);color:#725821;font-size:13px}.expense-alert.danger{background:var(--neg-bg);color:var(--neg)}
.link-btn{border:0;background:none;color:var(--green);padding:0;cursor:pointer;font:inherit}.row-actions{display:flex;gap:6px;justify-content:flex-end}.danger-text{color:var(--neg)!important}
@media(max-width:900px){.expense-kpis{grid-template-columns:repeat(2,1fr)}.expense-filters{grid-template-columns:repeat(2,1fr)}}
@media(max-width:580px){.expense-head{align-items:flex-start}.expense-kpis,.expense-filters{grid-template-columns:1fr}}
`;
