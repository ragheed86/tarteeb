'use client';
import { useEffect, useState } from 'react';
import { getGovernmentAccounts, createGovernmentAccount, updateGovernmentAccount, removeGovernmentAccount } from '@/lib/data';
import { fmtNum, fmtDate } from '@/lib/format';
import { Loading, Empty, ErrorBar, Modal, DataTable, Input, Select, Ltr, StatusPill } from '@/components';

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
        <DataTable
          rows={rows}
          rowClassName={(g) => { const n = daysUntil(g.expiry_date); return n !== null && n < 0 ? 'row-low' : ''; }}
          empty={<Empty title="لا حسابات" desc="أضف الجهات الحكومية ورخصها." />}
          columns={[
            {
              key: 'entity_name', label: 'الجهة', primary: true,
              render: (g) => (
                <>
                  <span className="nm">{g.entity_name}</span>
                  {g.login_url && <><br /><a href={g.login_url} target="_blank" rel="noreferrer" className="uid" style={{ color: 'var(--green)' }}>رابط الدخول ↗</a></>}
                </>
              ),
            },
            { key: 'username', label: 'المستخدم', render: (g) => <Ltr className="amt">{g.username || '—'}</Ltr> },
            {
              key: 'expiry_date', label: 'الانتهاء',
              render: (g) => {
                const n = daysUntil(g.expiry_date);
                const warn = n !== null && n <= 30;
                return <>{fmtDate(g.expiry_date)}{warn && n >= 0 && <span className="pill p-prog" style={{ marginInlineStart: 6 }}>خلال {fmtNum(n)} يوم</span>}</>;
              },
            },
            { key: 'status', label: 'الحالة', render: (g) => <StatusPill status={g.status} map={STATUS} /> },
            {
              key: 'actions', label: '', align: 'left',
              render: (g) => (
                <>
                  <button className="btn ghost sm" onClick={() => openEdit(g)}>تعديل</button>
                  <button className="btn ghost sm" style={{ marginInlineStart: 8, color: 'var(--neg)' }} onClick={() => del(g)}>حذف</button>
                </>
              ),
            },
          ]}
        />
      </div>

      <Modal
        open={open}
        onClose={close}
        title={editing ? 'تعديل حساب' : 'حساب حكومي جديد'}
        subtitle="الرخص والاشتراكات الحكومية"
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
        <div className="form-grid">
          <Input className="span-2" label="اسم الجهة" value={form.entity_name} onChange={(e) => set('entity_name', e.target.value)} required autoFocus placeholder="بلدي / قوى / هيئة الزكاة…" />
          <Input label="رابط الدخول" ltr value={form.login_url} onChange={(e) => set('login_url', e.target.value)} />
          <Input label="اسم المستخدم" ltr value={form.username} onChange={(e) => set('username', e.target.value)} />
          <Input label="مرجع السر (وليس كلمة المرور)" value={form.secret_ref} onChange={(e) => set('secret_ref', e.target.value)} placeholder="مثال: Vault/gov/qiwa" />
          <Input label="جهة الاتصال" value={form.contact} onChange={(e) => set('contact', e.target.value)} />
          <Input label="تاريخ الانتهاء" ltr type="date" value={form.expiry_date} onChange={(e) => set('expiry_date', e.target.value)} />
          <Select label="الحالة" value={form.status} onChange={(e) => set('status', e.target.value)}
            options={Object.entries(STATUS).map(([v, o]) => ({ value: v, label: o.label }))} />
        </div>
      </Modal>
    </>
  );
}
