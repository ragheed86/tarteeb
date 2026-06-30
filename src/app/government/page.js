'use client';
import { useEffect, useState } from 'react';
import { getGovernmentAccounts, createGovernmentAccount, updateGovernmentAccount, removeGovernmentAccount } from '@/lib/data';
import { fmtNum, fmtDate } from '@/lib/format';
import { Loading, Empty, ErrorBar } from '../ui';

const STATUS = {
  incomplete: { label: 'غير مكتمل', cls: 'p-wait' },
  active: { label: 'نشط', cls: 'p-done' },
  expiring: { label: 'قارب الانتهاء', cls: 'p-prog' },
  expired: { label: 'منتهٍ', cls: 'p-cancel' },
};

const EMPTY = { entity_name: '', login_url: '', username: '', secret_ref: '', contact: '', expiry_date: '', status: 'active' };

function daysUntil(d) { return d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) : null; }

export default function GovernmentPage() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');

  async function load() {
    try { setRows(await getGovernmentAccounts()); } catch (e) { setErr(e.message || 'تعذّر التحميل'); }
  }
  useEffect(() => { load(); }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function openAdd() { setEditing(null); setForm(EMPTY); setFormErr(''); setOpen(true); }
  function openEdit(g) {
    setEditing(g);
    setForm({ entity_name: g.entity_name || '', login_url: g.login_url || '', username: g.username || '', secret_ref: g.secret_ref || '', contact: g.contact || '', expiry_date: g.expiry_date || '', status: g.status || 'active' });
    setFormErr(''); setOpen(true);
  }
  function close() { if (!saving) { setOpen(false); setEditing(null); } }

  async function submit(e) {
    e.preventDefault();
    if (!form.entity_name.trim()) { setFormErr('اسم الجهة مطلوب'); return; }
    setSaving(true); setFormErr('');
    const payload = {
      entity_name: form.entity_name.trim(), login_url: form.login_url.trim() || null,
      username: form.username.trim() || null, secret_ref: form.secret_ref.trim() || null,
      contact: form.contact.trim() || null, expiry_date: form.expiry_date || null, status: form.status,
    };
    try {
      if (editing) { const up = await updateGovernmentAccount(editing.id, payload); setRows((s) => s.map((x) => (x.id === up.id ? up : x))); }
      else { const ng = await createGovernmentAccount(payload); setRows((s) => [ng, ...s]); }
      close();
    } catch (e2) { setFormErr(e2.message || 'تعذّر الحفظ'); }
    finally { setSaving(false); }
  }
  async function del(g) {
    if (!confirm(`حذف حساب «${g.entity_name}»؟`)) return;
    try { await removeGovernmentAccount(g.id); setRows((r) => r.filter((x) => x.id !== g.id)); }
    catch (e2) { setErr(e2.message || 'تعذّر الحذف'); }
  }

  if (err) return <ErrorBar message={err} />;
  if (!rows) return <Loading />;

  return (
    <>
      <div className="sec-head" style={{ marginBottom: 18 }}>
        <button className="btn" onClick={openAdd}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          حساب جديد
        </button>
        <span className="more" style={{ marginInlineStart: 'auto' }}>{fmtNum(rows.length)} جهة</span>
      </div>

      <div className="card" style={{ marginBottom: 14, background: 'var(--sage-bg)', border: '1px solid var(--line)' }}>
        <p style={{ fontSize: 13, color: 'var(--pine)', margin: 0, lineHeight: 1.7 }}>
          🔒 لا تُخزَّن كلمات المرور هنا. الحقل «مرجع السر» يشير فقط إلى مكان حفظ السر (Vault / مدير كلمات مرور).
        </p>
      </div>

      <div className="card" style={{ padding: '6px 0' }}>
        {rows.length === 0 ? (
          <Empty title="لا حسابات" desc="أضف الجهات الحكومية ورخصها." />
        ) : (
          <table>
            <thead><tr><th>الجهة</th><th>المستخدم</th><th>الانتهاء</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {rows.map((g) => {
                const st = STATUS[g.status] || { label: g.status, cls: 'p-wait' };
                const n = daysUntil(g.expiry_date);
                const warn = n !== null && n <= 30;
                return (
                  <tr key={g.id} className={n !== null && n < 0 ? 'row-low' : ''}>
                    <td>
                      <span className="nm">{g.entity_name}</span>
                      {g.login_url && <><br /><a href={g.login_url} target="_blank" rel="noreferrer" className="uid" style={{ color: 'var(--green)' }}>رابط الدخول ↗</a></>}
                    </td>
                    <td className="amt" dir="ltr" style={{ textAlign: 'start' }}>{g.username || '—'}</td>
                    <td>{fmtDate(g.expiry_date)}{warn && n >= 0 && <span className="pill p-prog" style={{ marginInlineStart: 6 }}>خلال {fmtNum(n)} يوم</span>}</td>
                    <td><span className={`pill ${st.cls}`}>{st.label}</span></td>
                    <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                      <button className="btn ghost sm" onClick={() => openEdit(g)}>تعديل</button>
                      <button className="btn ghost sm" style={{ marginInlineStart: 8, color: 'var(--neg)' }} onClick={() => del(g)}>حذف</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <form className="modal-card" onSubmit={submit}>
            <div className="modal-head">
              <div><h2>{editing ? 'تعديل حساب' : 'حساب حكومي جديد'}</h2><p>الرخص والاشتراكات الحكومية</p></div>
              <button className="icon-close" type="button" onClick={close} aria-label="إغلاق">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            {formErr && <div className="errbar">{formErr}</div>}
            <div className="form-grid">
              <div className="field span-2"><label>اسم الجهة</label><input value={form.entity_name} onChange={(e) => set('entity_name', e.target.value)} required autoFocus placeholder="بلدي / قوى / هيئة الزكاة…" /></div>
              <div className="field"><label>رابط الدخول</label><input value={form.login_url} onChange={(e) => set('login_url', e.target.value)} dir="ltr" /></div>
              <div className="field"><label>اسم المستخدم</label><input value={form.username} onChange={(e) => set('username', e.target.value)} dir="ltr" /></div>
              <div className="field"><label>مرجع السر (وليس كلمة المرور)</label><input value={form.secret_ref} onChange={(e) => set('secret_ref', e.target.value)} placeholder="مثال: Vault/gov/qiwa" /></div>
              <div className="field"><label>جهة الاتصال</label><input value={form.contact} onChange={(e) => set('contact', e.target.value)} /></div>
              <div className="field"><label>تاريخ الانتهاء</label><input type="date" value={form.expiry_date} onChange={(e) => set('expiry_date', e.target.value)} dir="ltr" /></div>
              <div className="field"><label>الحالة</label>
                <select value={form.status} onChange={(e) => set('status', e.target.value)}>
                  {Object.entries(STATUS).map(([v, o]) => <option key={v} value={v}>{o.label}</option>)}
                </select>
              </div>
            </div>
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
