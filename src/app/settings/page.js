'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getCompanySettings, updateCompanySettings } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import {
  ALL_PERMISSIONS, PERMISSION_GROUPS, ROLE_LABELS, ROLE_PRESETS, isPrimaryAdmin,
} from '@/lib/permissions';
import { Loading, ErrorBar } from '../ui';

const FIELDS = [
  { k: 'name_ar', label: 'الاسم (عربي)', required: true },
  { k: 'name_en', label: 'الاسم (إنجليزي)', dir: 'ltr' },
  { k: 'owner_name', label: 'اسم المالك' },
  { k: 'cr_number', label: 'السجل التجاري', dir: 'ltr' },
  { k: 'vat_number', label: 'الرقم الضريبي', dir: 'ltr' },
  { k: 'unified_national_number', label: 'الرقم الوطني الموحّد', dir: 'ltr' },
  { k: 'commercial_code', label: 'الرمز التجاري', dir: 'ltr' },
  { k: 'municipality_license', label: 'رخصة البلدية', dir: 'ltr' },
  { k: 'cr_expiry', label: 'انتهاء السجل', type: 'date', dir: 'ltr' },
  { k: 'capital', label: 'رأس المال', type: 'number', dir: 'ltr' },
  { k: 'phone', label: 'الجوال', dir: 'ltr' },
  { k: 'email', label: 'البريد الإلكتروني', dir: 'ltr' },
  { k: 'city', label: 'المدينة' },
  { k: 'website', label: 'الموقع الإلكتروني', dir: 'ltr' },
];

export default function SettingsPage() {
  const [row, setRow] = useState(null);
  const [form, setForm] = useState({});
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState('company');

  useEffect(() => {
    getCompanySettings()
      .then((r) => { setRow(r); setForm(r || {}); })
      .catch((e) => setErr(e.message || 'تعذّر التحميل'));
  }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); setSaved(false); }

  async function submit(e) {
    e.preventDefault();
    if (!form.name_ar?.trim()) { setErr('اسم الشركة (عربي) مطلوب'); return; }
    setSaving(true); setErr('');
    const payload = {};
    for (const f of FIELDS) {
      const v = form[f.k];
      if (f.type === 'number') payload[f.k] = v === '' || v == null ? null : Number(v);
      else payload[f.k] = (v ?? '').toString().trim() || null;
    }
    payload.address = (form.address ?? '').trim() || null;
    payload.name_ar = form.name_ar.trim();
    try {
      const up = await updateCompanySettings(row.id, payload);
      setRow(up); setForm(up); setSaved(true);
    } catch (e2) { setErr(e2.message || 'تعذّر الحفظ'); }
    finally { setSaving(false); }
  }

  if (err && !row) return <ErrorBar message={err} />;
  if (!row) return <Loading />;

  return (
    <>
      <div className="settabs">
        <button className={`settab${tab === 'company' ? ' active' : ''}`} onClick={() => setTab('company')} type="button">معلومات الشركة</button>
        <button className={`settab${tab === 'suppliers' ? ' active' : ''}`} onClick={() => setTab('suppliers')} type="button">الموردون</button>
        <button className={`settab${tab === 'gov' ? ' active' : ''}`} onClick={() => setTab('gov')} type="button">الجهات الحكومية والرخص</button>
        <button className={`settab${tab === 'team' ? ' active' : ''}`} onClick={() => setTab('team')} type="button">الفريق والصلاحيات</button>
      </div>

      {tab === 'company' && (
        <form className="card" style={{ maxWidth: 760, margin: '0 auto' }} onSubmit={submit}>
          <div className="notebar">هذه البيانات تظهر تلقائياً على الفواتير والمستندات الرسمية.</div>
          <div className="sec-head"><h2>معلومات الشركة</h2><span className="more">تظهر على الفواتير</span></div>
          {err && <div className="errbar">{err}</div>}
          {saved && <div className="okbar">تم حفظ التغييرات بنجاح ✓</div>}
          <div className="form-grid">
            {FIELDS.map((f) => (
              <div className="field" key={f.k}>
                <label>{f.label}{f.required && ' *'}</label>
                <input
                  type={f.type || 'text'}
                  dir={f.dir || 'rtl'}
                  value={form[f.k] ?? ''}
                  onChange={(e) => set(f.k, e.target.value)}
                  required={f.required}
                />
              </div>
            ))}
            <div className="field span-2">
              <label>العنوان</label>
              <textarea rows={2} value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} />
            </div>
          </div>
          <div className="modal-actions" style={{ marginTop: 18 }}>
            <button className="btn" type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ المعلومات'}</button>
          </div>
        </form>
      )}

      {tab === 'suppliers' && (
        <div>
          <div className="notebar" style={{ background: 'var(--sage-bg)', borderColor: '#bcd4c5', color: '#2c5347' }}>إدارة الموردين وربطهم بالمنتجات والمستودع.</div>
          <div className="card">
            <div className="sec-head"><h2>الموردون</h2><Link className="btn" href="/suppliers">فتح إدارة الموردين</Link></div>
            <div className="note" style={{ textAlign: 'start' }}>تعرض صفحة الموردين الإضافة والتعديل والحذف وربط الموردين بمنتجات المستودع.</div>
          </div>
        </div>
      )}

      {tab === 'gov' && (
        <div>
          <div className="notebar">جدول موحّد لحسابات الجهات الحكومية وبيانات الدخول والمستندات وتواريخ الانتهاء. ينبّه النظام قبل 30 يوماً من انتهاء أي رخصة.</div>
          <div className="card">
            <div className="sec-head"><h2>الجهات الحكومية والرخص</h2><Link className="btn" href="/government">فتح إدارة الجهات</Link></div>
            <table>
              <thead><tr><th>#</th><th>الجهة</th><th>الدخول</th><th>المستندات</th><th>الحالة</th></tr></thead>
              <tbody>
                {['البنك', 'بلدي', 'قوى', 'أبشر أعمال', 'وزارة الموارد البشرية', 'مقيم', 'الدفاع المدني (سلامة)', 'هيئة الزكاة والضريبة والجمارك', 'البريد السعودي (سبل)', 'التأمينات الاجتماعية', 'الغرفة التجارية', 'وزارة التجارة'].map((name, i) => (
                  <tr key={name}><td>{i + 1}</td><td className="nm">{name}</td><td><span className="link">فتح ↗</span></td><td><span className="link">📎 إرفاق</span></td><td><span className="pill p-wait">غير مكتمل</span></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'team' && (
        <UserPermissions />
      )}
    </>
  );
}

const EMPTY_USER = {
  email: '',
  display_name: '',
  password: '',
  role: 'viewer',
  permissions: ROLE_PRESETS.viewer,
  active: true,
};

function UserPermissions() {
  const [users, setUsers] = useState(null);
  const [form, setForm] = useState(EMPTY_USER);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function authHeaders() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token || ''}` };
  }

  async function load() {
    setErr('');
    try {
      const { data, error } = await supabase
        .from('app_user_access')
        .select('user_id,email,display_name,role,permissions,active,created_at,updated_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setUsers(data || []);
    } catch (e) {
      setErr(e.message || 'تعذّر تحميل المستخدمين');
      setUsers([]);
    }
  }

  useEffect(() => { load(); }, []);

  function setField(key, value) {
    setForm((current) => {
      if (key === 'role') {
        return {
          ...current,
          role: value,
          permissions: value === 'admin' ? ALL_PERMISSIONS : ROLE_PRESETS[value] || [],
        };
      }
      return { ...current, [key]: value };
    });
    setMsg(''); setErr('');
  }

  function togglePermission(permission) {
    setForm((current) => {
      const set = new Set(current.permissions || []);
      if (set.has(permission)) set.delete(permission);
      else set.add(permission);
      return { ...current, permissions: [...set], role: current.role === 'admin' ? 'manager' : current.role };
    });
  }

  function edit(user) {
    setEditing(user);
    setForm({
      email: user.email || '',
      display_name: user.display_name || '',
      password: '',
      role: user.role || 'viewer',
      permissions: user.permissions || [],
      active: user.active !== false,
      user_id: user.user_id,
    });
    setMsg(''); setErr('');
  }

  function reset() {
    setEditing(null);
    setForm(EMPTY_USER);
    setMsg(''); setErr('');
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(''); setMsg('');
    try {
      if (editing && !form.password) {
        const { error } = await supabase
          .from('app_user_access')
          .upsert({
            user_id: form.user_id,
            email: form.email,
            display_name: form.display_name || null,
            role: isPrimaryAdmin(form.email) ? 'admin' : form.role,
            permissions: isPrimaryAdmin(form.email) ? ALL_PERMISSIONS : form.permissions,
            active: isPrimaryAdmin(form.email) ? true : form.active,
          }, { onConflict: 'user_id' });
        if (error) throw error;
      } else {
        const res = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify(form),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'تعذّر حفظ المستخدم');
      }
      setMsg(editing ? 'تم تحديث صلاحيات المستخدم' : 'تم إنشاء المستخدم وتفعيل صلاحياته');
      reset();
      await load();
    } catch (e2) {
      setErr(e2.message || 'تعذّر حفظ المستخدم');
    } finally {
      setBusy(false);
    }
  }

  async function disable(user) {
    if (isPrimaryAdmin(user.email)) return;
    if (!confirm(`تعطيل دخول ${user.email}؟`)) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const { error } = await supabase
        .from('app_user_access')
        .update({ active: false })
        .eq('user_id', user.user_id);
      if (error) throw error;
      setMsg('تم تعطيل المستخدم');
      await load();
    } catch (e2) {
      setErr(e2.message || 'تعذّر تعطيل المستخدم');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="permissions-grid">
      <form className="card permissions-form" onSubmit={submit}>
        <div className="sec-head">
          <h2>{editing ? 'تعديل صلاحيات مستخدم' : 'إضافة مستخدم وصلاحيات'}</h2>
          {editing && <button className="btn ghost sm" type="button" onClick={reset}>إضافة جديد</button>}
        </div>
        <div className="notebar" style={{ background: 'var(--sage-bg)', borderColor: '#bcd4c5', color: '#2c5347' }}>
          رغيد هو الأدمن الأساسي دائماً، ولا يمكن تعطيل حسابه أو إزالة صلاحياته.
        </div>
        {err && <div className="errbar">{err}</div>}
        {msg && <div className="okbar">{msg}</div>}
        <div className="form-grid">
          <div className="field"><label>البريد الإلكتروني</label><input value={form.email} onChange={(e) => setField('email', e.target.value)} dir="ltr" type="email" required disabled={Boolean(editing)} /></div>
          <div className="field"><label>الاسم</label><input value={form.display_name} onChange={(e) => setField('display_name', e.target.value)} /></div>
          <div className="field"><label>{editing ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور'}</label><input value={form.password} onChange={(e) => setField('password', e.target.value)} dir="ltr" type="password" required={!editing} minLength={6} /></div>
          <div className="field"><label>الدور</label>
            <select value={form.role} onChange={(e) => setField('role', e.target.value)} disabled={isPrimaryAdmin(form.email)}>
              {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </div>
        <label className="checkline" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={form.active} disabled={isPrimaryAdmin(form.email)} onChange={(e) => setField('active', e.target.checked)} />
          <span>الحساب مفعّل</span>
        </label>
        <div className="permission-groups">
          {PERMISSION_GROUPS.map((group) => (
            <div className="permission-group" key={group.group}>
              <h3>{group.group}</h3>
              {group.items.map((permission) => (
                <label className="permission-check" key={permission.key}>
                  <input
                    type="checkbox"
                    checked={isPrimaryAdmin(form.email) || (form.permissions || []).includes(permission.key)}
                    disabled={isPrimaryAdmin(form.email)}
                    onChange={() => togglePermission(permission.key)}
                  />
                  <span>
                    <b>{permission.label}</b>
                    <small>{permission.description}</small>
                  </span>
                </label>
              ))}
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn" type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ الصلاحيات'}</button>
        </div>
      </form>

      <div className="card permissions-list">
        <div className="sec-head"><h2>المستخدمون</h2><span className="more">{users ? users.length : '—'}</span></div>
        {!users ? <Loading /> : users.length === 0 ? (
          <div className="note">لا توجد حسابات صلاحيات بعد.</div>
        ) : users.map((user) => (
          <div className="user-access-row" key={user.user_id}>
            <div>
              <b>{user.display_name || user.email}</b>
              <span dir="ltr">{user.email}</span>
              <small>{ROLE_LABELS[user.role] || user.role} · {user.permissions?.length || 0} صلاحية</small>
            </div>
            <span className={`pill ${user.active ? 'p-done' : 'p-cancel'}`}>{user.active ? 'مفعّل' : 'معطّل'}</span>
            <button className="btn ghost sm" type="button" onClick={() => edit(user)}>تعديل</button>
            <button className="btn ghost sm" type="button" disabled={isPrimaryAdmin(user.email)} onClick={() => disable(user)}>تعطيل</button>
          </div>
        ))}
      </div>
    </div>
  );
}
