'use client';
import { useEffect, useState } from 'react';
import {
  getPartners, createPartner, updatePartner, removePartner,
  getPartnerTransactions, createPartnerTransaction, removePartnerTransaction,
} from '@/lib/data';
import { fmtMoney, fmtNum, fmtDate } from '@/lib/format';
import { Loading, Empty, ErrorBar } from '../ui';

// إشارة كل نوع حركة على الرصيد
const TXN = {
  profit_share: { label: 'توزيع أرباح', sign: 1 },
  deposit: { label: 'إيداع', sign: 1 },
  carryover: { label: 'ترحيل', sign: 1 },
  withdrawal: { label: 'سحب', sign: -1 },
};

const EMPTY_P = { name: '', share_percent: '' };

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
      const [partners, txns] = await Promise.all([getPartners(), getPartnerTransactions()]);
      setD({ partners, txns });
    } catch (e) { setErr(e.message || 'تعذّر التحميل'); }
  }
  useEffect(() => { load(); }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function openAdd() { setEditing(null); setForm(EMPTY_P); setFormErr(''); setOpen(true); }
  function openEdit(p) { setEditing(p); setForm({ name: p.name || '', share_percent: p.share_percent ?? '' }); setFormErr(''); setOpen(true); }
  function close() { if (!saving) { setOpen(false); setEditing(null); } }

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setFormErr('اسم الشريك مطلوب'); return; }
    setSaving(true); setFormErr('');
    const payload = { name: form.name.trim(), share_percent: Number(form.share_percent) || 0 };
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
        {partners.length === 0 ? (
          <Empty title="لا شركاء" desc="أضف الشركاء ونِسبهم." />
        ) : (
          <table>
            <thead><tr><th>الشريك</th><th>النسبة</th><th>الرصيد</th><th></th></tr></thead>
            <tbody>
              {partners.map((p) => {
                const bal = balance(p.id);
                return (
                  <tr key={p.id}>
                    <td><span className="nm">{p.name}</span></td>
                    <td className="amt">{fmtNum(p.share_percent)}%</td>
                    <td className="amt" style={{ color: bal < 0 ? 'var(--neg)' : 'var(--pos)' }}>{fmtMoney(bal)} ر.س</td>
                    <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                      <button className="btn ghost sm" onClick={() => openEdit(p)}>تعديل</button>
                      <button className="btn ghost sm" style={{ marginInlineStart: 8, color: 'var(--neg)' }} onClick={() => delP(p)}>حذف</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
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
        {txns.length === 0 ? (
          <Empty title="لا حركات" desc="سجّل توزيعات الأرباح والسحوبات." />
        ) : (
          <table>
            <thead><tr><th>الشريك</th><th>النوع</th><th>المبلغ</th><th>الفترة</th><th>ملاحظة</th><th></th></tr></thead>
            <tbody>
              {txns.map((t) => {
                const meta = TXN[t.txn_type] || { label: t.txn_type, sign: 1 };
                return (
                  <tr key={t.id}>
                    <td>{nameById[t.partner_id] || '—'}</td>
                    <td><span className={`pill ${meta.sign < 0 ? 'p-cancel' : 'p-done'}`}>{meta.label}</span></td>
                    <td className="amt">{meta.sign < 0 ? '−' : '+'}{fmtMoney(t.amount)} ر.س</td>
                    <td>{fmtDate(t.period)}</td>
                    <td>{t.note || '—'}</td>
                    <td style={{ textAlign: 'left' }}><button className="x-btn" onClick={() => delTx(t)}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <form className="modal-card modal-sm" onSubmit={submit}>
            <div className="modal-head">
              <div><h2>{editing ? 'تعديل شريك' : 'شريك جديد'}</h2><p>الاسم ونسبة الشراكة</p></div>
              <button className="icon-close" type="button" onClick={close} aria-label="إغلاق">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            {formErr && <div className="errbar">{formErr}</div>}
            <div className="field"><label>اسم الشريك</label><input value={form.name} onChange={(e) => set('name', e.target.value)} required autoFocus /></div>
            <div className="field"><label>نسبة الشراكة (%)</label><input type="number" min="0" max="100" step="0.01" value={form.share_percent} onChange={(e) => set('share_percent', e.target.value)} dir="ltr" /></div>
            <div className="modal-actions">
              <button className="btn ghost" type="button" onClick={close} disabled={saving}>إلغاء</button>
              <button className="btn" type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
