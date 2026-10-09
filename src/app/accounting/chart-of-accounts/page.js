'use client';
import { useEffect, useMemo, useState } from 'react';
import { getChartOfAccounts, createAccount, updateAccount } from '@/lib/data';
import { Loading, Empty, ErrorBar, Modal, DataTable, Input, Select, StatusPill } from '@/components';
import { toast } from '@/app/toast';

const TYPE_LABELS = {
  asset: { label: 'أصل', cls: 'p-done' },
  liability: { label: 'خصم', cls: 'p-cancel' },
  equity: { label: 'حقوق ملكية', cls: 'p-wait' },
  revenue: { label: 'إيراد', cls: 'p-done' },
  expense: { label: 'مصروف', cls: 'p-cancel' },
};
const EMPTY_FORM = { code: '', name_ar: '', name_en: '', account_type: 'expense', normal_balance: 'debit', parent_id: '' };

export default function ChartOfAccountsPage() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  async function load() {
    try { setRows(await getChartOfAccounts()); } catch (loadError) { setError(loadError.message || 'تعذّر تحميل دليل الحسابات'); }
  }
  useEffect(() => { load(); }, []);

  const byParent = useMemo(() => {
    const map = new Map();
    (rows || []).forEach((row) => { if (row.parent_id) map.set(row.id, row.parent_id); });
    return map;
  }, [rows]);
  const nameOf = (id) => (rows || []).find((row) => row.id === id)?.name_ar || '—';

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setOpen(true);
  }
  function openEdit(row) {
    setEditing(row);
    setForm({ code: row.code, name_ar: row.name_ar, name_en: row.name_en || '', account_type: row.account_type, normal_balance: row.normal_balance, parent_id: row.parent_id || '' });
    setFormError('');
    setOpen(true);
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.code.trim() || !form.name_ar.trim()) { setFormError('أدخل الكود والاسم'); return; }
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim(), name_ar: form.name_ar.trim(), name_en: form.name_en.trim() || null,
        account_type: form.account_type, normal_balance: form.normal_balance, parent_id: form.parent_id || null,
      };
      if (editing) await updateAccount(editing.id, payload);
      else await createAccount(payload);
      setOpen(false);
      await load();
      toast(editing ? 'تم تعديل الحساب' : 'تمت إضافة الحساب');
    } catch (submitError) {
      setFormError(submitError.message || 'تعذّر حفظ الحساب');
    } finally { setSaving(false); }
  }

  async function toggleActive(row) {
    try { await updateAccount(row.id, { active: !row.active }); await load(); } catch (toggleError) { toast(toggleError.message || 'تعذّر تحديث الحساب', 'error'); }
  }

  if (error) return <ErrorBar message={error} />;
  if (!rows) return <Loading />;

  return (
    <>
      <div className="sec-head">
        <div><h2>دليل الحسابات</h2><p>الهيكل المحاسبي الأساسي (نظامي) + حسابات فرعية قابلة للإضافة.</p></div>
        <button className="btn" type="button" onClick={openNew}>+ حساب جديد</button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <DataTable
          rows={rows}
          empty={<Empty title="لا توجد حسابات" desc="أضف أول حساب محاسبي." />}
          columns={[
            { key: 'code', label: 'الكود', primary: true, ltr: true, width: 90 },
            { key: 'name_ar', label: 'الاسم', render: (row) => (
              <>
                <span className="nm">{row.name_ar}</span>
                {byParent.get(row.id) && <small> ← {nameOf(byParent.get(row.id))}</small>}
              </>
            ) },
            { key: 'account_type', label: 'النوع', render: (row) => <StatusPill status={row.account_type} map={TYPE_LABELS} /> },
            { key: 'normal_balance', label: 'الطبيعة', render: (row) => (row.normal_balance === 'debit' ? 'مدين' : 'دائن') },
            { key: 'is_system', label: 'نظامي', render: (row) => (row.is_system ? 'نعم' : 'لا') },
            { key: 'active', label: 'نشط', render: (row) => (
              <button type="button" className="btn ghost sm" onClick={() => toggleActive(row)}>{row.active ? 'نشط' : 'معطّل'}</button>
            ) },
            { key: 'actions', label: '', render: (row) => (
              !row.is_system && <button type="button" className="btn ghost sm" onClick={() => openEdit(row)}>تعديل</button>
            ) },
          ]}
        />
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'تعديل حساب' : 'حساب جديد'} as="form" onSubmit={submit}
        footer={<><button type="button" className="btn ghost" onClick={() => setOpen(false)}>إلغاء</button><button type="submit" className="btn" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ'}</button></>}>
        {formError && <ErrorBar message={formError} />}
          <Input label="الكود" value={form.code} ltr onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} disabled={!!editing} />
          <Input label="الاسم بالعربي" value={form.name_ar} onChange={(e) => setForm((f) => ({ ...f, name_ar: e.target.value }))} />
          <Input label="الاسم بالإنجليزي" value={form.name_en} onChange={(e) => setForm((f) => ({ ...f, name_en: e.target.value }))} />
          <Select label="النوع" value={form.account_type} onChange={(e) => {
            const account_type = e.target.value;
            const normal_balance = ['liability', 'equity', 'revenue'].includes(account_type) ? 'credit' : 'debit';
            setForm((f) => ({ ...f, account_type, normal_balance }));
          }} options={[
            { value: 'asset', label: 'أصل' }, { value: 'liability', label: 'خصم' }, { value: 'equity', label: 'حقوق ملكية' },
            { value: 'revenue', label: 'إيراد' }, { value: 'expense', label: 'مصروف' },
          ]} />
          <Select label="الحساب الأب" value={form.parent_id} onChange={(e) => setForm((f) => ({ ...f, parent_id: e.target.value }))} options={[
            { value: '', label: '— بلا —' },
            ...rows.filter((row) => row.account_type === form.account_type).map((row) => ({ value: row.id, label: `${row.code} — ${row.name_ar}` })),
          ]} />
      </Modal>
    </>
  );
}
