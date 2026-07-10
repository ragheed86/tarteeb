'use client';
import { useEffect, useState } from 'react';
import {
  getPartners, createPartner, updatePartner, removePartner,
  getPartnerTransactions, createPartnerTransaction, removePartnerTransaction, getEmployees,
} from '@/lib/data';
import { fmtMoney, fmtNum } from '@/lib/format';
import { Loading, Empty, ErrorBar, Modal, DataTable, Input, Select, Money, DateText } from '@/components';

// إشارة كل نوع حركة على الرصيد
const TXN = {
  profit_share: { label: 'توزيع أرباح', sign: 1 },
  deposit: { label: 'إيداع', sign: 1 },
  carryover: { label: 'ترحيل', sign: 1 },
  withdrawal: { label: 'سحب', sign: -1 },
};

const EMPTY_P = { employee_id: '', share_percent: '' };

export default function PartnersPage() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  // نموذج الشريك
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_P);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  // نموذج الحركة
  const [tx, setTx] = useState({ partner_id: '', period: '', txn_type: 'profit_share', amount: '', note: '' });
  const [txBusy, setTxBusy] = useState(false);

  async function load() {
    try {
      const [partners, txns, employees] = await Promise.all([getPartners(), getPartnerTransactions(), getEmployees()]);
      setD({ partners, txns, employees });
    } catch (e) { setErr(e.message || 'تعذّر التحميل'); }
  }
  useEffect(() => { load(); }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function openAdd() { setEditing(null); setForm(EMPTY_P); setFormErr(''); setOpen(true); }
  function openEdit(p) { setEditing(p); setForm({ employee_id: p.employee_id || '', share_percent: p.share_percent ?? '' }); setFormErr(''); setOpen(true); }
  function close() { if (!saving) { setOpen(false); setEditing(null); } }

  async function submit(e) {
    e.preventDefault();
    if (!form.employee_id) { setFormErr('اختر الموظف الشريك'); return; }
    setSaving(true); setFormErr('');
    const employee = d.employees.find((em) => em.id === form.employee_id);
    const payload = { name: employee?.name || '', employee_id: form.employee_id, share_percent: Number(form.share_percent) || 0 };
    try {
      if (editing) { const up = await updatePartner(editing.id, payload); setD((s) => ({ ...s, partners: s.partners.map((x) => (x.id === up.id ? up : x)) })); }
      else { const np = await createPartner(payload); setD((s) => ({ ...s, partners: [...s.partners, np] })); }
      close();
    } catch (e2) { setFormErr(e2.message || 'تعذّر الحفظ'); }
    finally { setSaving(false); }
  }
  async function delP(p) {
    if (!confirm(`حذف الشريك «${p.name}»؟ ستُحذف حركاته أيضاً.`)) return;
    try { await removePartner(p.id); await load(); }
    catch (e2) { setErr(e2.message || 'تعذّر الحذف'); }
  }

  async function addTx(e) {
    e.preventDefault();
    if (!tx.partner_id || !tx.amount) return;
    setTxBusy(true);
    try {
      await createPartnerTransaction({
        partner_id: tx.partner_id,
        period: tx.period || new Date().toISOString().slice(0, 10),
        txn_type: tx.txn_type, amount: Number(tx.amount) || 0, note: tx.note.trim() || null,
      });
      setTx({ partner_id: '', period: '', txn_type: 'profit_share', amount: '', note: '' });
      await load();
    } finally { setTxBusy(false); }
  }
  async function delTx(t) { await removePartnerTransaction(t.id); await load(); }

  if (err) return <ErrorBar message={err} />;
  if (!d) return <Loading />;

  const { partners, txns } = d;
  const nameById = Object.fromEntries(partners.map((p) => [p.id, p.name]));
  const balance = (pid) => txns.filter((t) => t.partner_id === pid)
    .reduce((s, t) => s + (TXN[t.txn_type]?.sign ?? 1) * Number(t.amount || 0), 0);
  const totalShare = partners.reduce((s, p) => s + Number(p.share_percent || 0), 0);

  return (
    <>
      <div className="sec-head" style={{ marginBottom: 18 }}>
        <button className="btn" onClick={openAdd}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          شريك جديد
        </button>
        <span className="more" style={{ marginInlineStart: 'auto' }}>{fmtNum(partners.length)} شريك · مجموع النِسب {fmtNum(totalShare)}%</span>
      </div>

      <div className="card" style={{ padding: '6px 0', marginBottom: 16 }}>
        <DataTable
          rows={partners}
          empty={<Empty title="لا شركاء" desc="أضف الشركاء ونِسبهم." />}
          columns={[
            { key: 'name', label: 'الشريك', primary: true, render: (p) => <span className="nm">{p.name}</span> },
            { key: 'share_percent', label: 'النسبة', render: (p) => <span className="amt" dir="ltr">{fmtNum(p.share_percent)}%</span> },
            {
              key: 'balance', label: 'الرصيد',
              render: (p) => {
                const bal = balance(p.id);
                return <span style={{ color: bal < 0 ? 'var(--neg)' : 'var(--pos)' }}><Money v={bal} /></span>;
              },
            },
            {
              key: 'actions', label: '', align: 'left',
              render: (p) => (
                <>
                  <button className="btn ghost sm" onClick={() => openEdit(p)}>تعديل</button>
                  <button className="btn ghost sm" style={{ marginInlineStart: 8, color: 'var(--neg)' }} onClick={() => delP(p)}>حذف</button>
                </>
              ),
            },
          ]}
        />
      </div>

      {/* الحركات */}
      <div className="card" style={{ padding: '6px 0' }}>
        <div className="sec-head" style={{ padding: '14px 20px 0' }}><h2>حركات الشركاء</h2><span className="more">{fmtNum(txns.length)} حركة</span></div>
        {partners.length > 0 && (
          <form onSubmit={addTx} className="inline-add" style={{ padding: '0 20px' }}>
            <select value={tx.partner_id} onChange={(e) => setTx((t) => ({ ...t, partner_id: e.target.value }))} style={{ maxWidth: 150 }} required>
              <option value="">الشريك…</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={tx.txn_type} onChange={(e) => setTx((t) => ({ ...t, txn_type: e.target.value }))} style={{ maxWidth: 140 }}>
              {Object.entries(TXN).map(([v, o]) => <option key={v} value={v}>{o.label}</option>)}
            </select>
            <input type="number" min="0" step="0.01" placeholder="المبلغ" dir="ltr" style={{ maxWidth: 120 }} value={tx.amount} onChange={(e) => setTx((t) => ({ ...t, amount: e.target.value }))} />
            <input type="date" dir="ltr" style={{ maxWidth: 150 }} value={tx.period} onChange={(e) => setTx((t) => ({ ...t, period: e.target.value }))} />
            <input placeholder="ملاحظة" value={tx.note} onChange={(e) => setTx((t) => ({ ...t, note: e.target.value }))} />
            <button className="btn sm" disabled={txBusy}>إضافة</button>
          </form>
        )}
        <DataTable
          rows={txns}
          pageSize={50}
          empty={<Empty title="لا حركات" desc="سجّل توزيعات الأرباح والسحوبات." />}
          columns={[
            { key: 'partner', label: 'الشريك', primary: true, render: (t) => nameById[t.partner_id] || '—' },
            {
              key: 'txn_type', label: 'النوع',
              render: (t) => {
                const meta = TXN[t.txn_type] || { label: t.txn_type, sign: 1 };
                return <span className={`pill ${meta.sign < 0 ? 'p-cancel' : 'p-done'}`}>{meta.label}</span>;
              },
            },
            {
              key: 'amount', label: 'المبلغ',
              render: (t) => {
                const meta = TXN[t.txn_type] || { label: t.txn_type, sign: 1 };
                return <span className="amt" dir="ltr">{meta.sign < 0 ? '−' : '+'}{fmtMoney(t.amount)} ⃁</span>;
              },
            },
            { key: 'period', label: 'الفترة', render: (t) => <DateText v={t.period} /> },
            { key: 'note', label: 'ملاحظة', render: (t) => t.note || '—' },
            {
              key: 'actions', label: '', align: 'left',
              render: (t) => <button className="x-btn" onClick={() => delTx(t)} aria-label="حذف الحركة">✕</button>,
            },
          ]}
        />
      </div>

      <Modal
        open={open}
        onClose={close}
        size="sm"
        title={editing ? 'تعديل شريك' : 'شريك جديد'}
        subtitle="الاسم ونسبة الشراكة"
        as="form"
        onSubmit={submit}
        footer={(
          <>
            <button className="btn ghost" type="button" onClick={close} disabled={saving}>إلغاء</button>
            <button className="btn" type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ'}</button>
          </>
        )}
      >
        {formErr && <div className="errbar">{formErr}</div>}
        <Select label="الموظف الشريك" value={form.employee_id} onChange={(e) => set('employee_id', e.target.value)} required autoFocus>
          <option value="" disabled>اختر موظفاً…</option>
          {d.employees
            .filter((em) => em.id === form.employee_id || !d.partners.some((p) => p.employee_id === em.id))
            .map((em) => <option key={em.id} value={em.id}>{em.name}</option>)}
        </Select>
        <Input label="نسبة الشراكة (%)" ltr type="number" min="0" max="100" step="0.01" value={form.share_percent} onChange={(e) => set('share_percent', e.target.value)} />
      </Modal>
    </>
  );
}
