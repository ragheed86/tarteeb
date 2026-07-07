'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  getCompanySettings, updateCompanySettings,
  getSuppliers, createSupplier, updateSupplier, removeSupplier,
  getGovernmentAccounts, updateGovernmentAccount, uploadGovDocument,
} from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { fmtNum, fmtDate } from '@/lib/format';
import {
  ALL_PERMISSIONS, PERMISSION_GROUPS, ROLE_LABELS, ROLE_PRESETS, isPrimaryAdmin,
} from '@/lib/permissions';
import { Loading, ErrorBar, Empty } from '../ui';

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

const NAV = [
  {
    label: 'وصول سريع',
    items: [{ key: 'suppliers', label: 'الموردون', icon: IconTruck, badge: 'suppliers' }],
  },
  {
    label: 'الإدارة',
    items: [
      { key: 'team', label: 'الفريق والصلاحيات', icon: IconUsers, badge: 'users' },
      { key: 'gov', label: 'الجهات الحكومية والرخص', icon: IconBank, badge: 'gov' },
    ],
  },
  {
    label: 'بيانات ثابتة',
    items: [{ key: 'company', label: 'معلومات الشركة', icon: IconStore }],
  },
];

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${data.session?.access_token || ''}` };
}

// رأس موحّد لكل قسم: الأيقونة والعنوان يميناً وأدوات القسم يساراً على سطر واحد
function PanelHead({ icon: Icon, title, children }) {
  return (
    <div className="set-head">
      <Icon />
      <h1>{title}</h1>
      {children && <div className="set-head-actions">{children}</div>}
    </div>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState('suppliers');
  const [company, setCompany] = useState(null);
  const [suppliers, setSuppliers] = useState(null);
  const [users, setUsers] = useState(null);
  const [gov, setGov] = useState(null);
  const [err, setErr] = useState('');

  async function loadUsers() {
    // القراءة عبر API الأدمن حتى تعمل الشاشة لأي مدير (لا للأدمن الأساسي فقط كما مع RLS المباشرة)
    const res = await fetch('/api/admin/users', { headers: await authHeaders() });
    if (res.ok) {
      const json = await res.json();
      setUsers(json.users || []);
      return;
    }
    // فولباك عند غياب مفتاح الخدمة على السيرفر: قراءة مباشرة تنجح للأدمن الأساسي عبر RLS
    const { data, error } = await supabase
      .from('app_user_access')
      .select('user_id,email,display_name,role,permissions,active,created_at,updated_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    setUsers(data || []);
  }

  useEffect(() => {
    getCompanySettings().then((r) => setCompany(r || {})).catch((e) => setErr(e.message || 'تعذّر التحميل'));
    getSuppliers().then((r) => setSuppliers(r || [])).catch(() => setSuppliers([]));
    getGovernmentAccounts().then((r) => setGov(r || [])).catch(() => setGov([]));
    loadUsers().catch(() => setUsers([]));
  }, []);

  const counts = { suppliers: suppliers?.length, users: users?.length, gov: gov?.length };

  if (err && !company) return <ErrorBar message={err} />;

  return (
    <div className="set-layout">
      <aside className="set-side">
        {NAV.map((group) => (
          <div key={group.label}>
            <div className="set-nav-label">{group.label}</div>
            {group.items.map((item) => {
              const Icon = item.icon;
              const count = item.badge ? counts[item.badge] : undefined;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`set-nav-item${tab === item.key ? ' active' : ''}`}
                  onClick={() => setTab(item.key)}
                >
                  <Icon />
                  <span className="lbl">{item.label}</span>
                  {count != null && <span className="set-badge">{fmtNum(count)}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </aside>

      {tab === 'suppliers' && <SuppliersPanel rows={suppliers} setRows={setSuppliers} />}
      {tab === 'team' && <UserPermissions users={users} reload={loadUsers} />}
      {tab === 'gov' && <GovPanel rows={gov} setRows={setGov} />}
      {tab === 'company' && <CompanyForm row={company} setRow={setCompany} />}
    </div>
  );
}

/* ============================ الموردون (مضمّن) ============================ */

const EMPTY_SUPPLIER = { name: '', category: '', city: '', logo_url: '' };

function SuppliersPanel({ rows, setRows }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_SUPPLIER);
  const [logoPreview, setLogoPreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [err, setErr] = useState('');

  const filtered = useMemo(() => {
    if (!rows) return null;
    const term = q.trim();
    if (!term) return rows;
    return rows.filter((s) => `${s.name} ${s.category || ''} ${s.city || ''}`.includes(term));
  }, [rows, q]);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function openAdd() { setEditing(null); setForm(EMPTY_SUPPLIER); setLogoPreview(''); setFormErr(''); setOpen(true); }
  function openEdit(s) { setEditing(s); setForm({ name: s.name || '', category: s.category || '', city: s.city || '', logo_url: s.logo_url || '' }); setLogoPreview(''); setFormErr(''); setOpen(true); }
  function close() { if (!saving) { setOpen(false); setEditing(null); setLogoPreview(''); } }
  function handleLogoFile(e) { const file = e.target.files?.[0]; if (file) setLogoPreview(URL.createObjectURL(file)); }

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setFormErr('اسم المورّد مطلوب'); return; }
    setSaving(true); setFormErr('');
    const payload = { name: form.name.trim(), category: form.category.trim() || 'أخرى', city: form.city.trim() || null, logo_url: form.logo_url.trim() || null };
    try {
      if (editing) { const up = await updateSupplier(editing.id, payload); setRows((s) => s.map((x) => (x.id === up.id ? up : x))); }
      else { const ns = await createSupplier(payload); setRows((s) => [ns, ...(s || [])]); }
      close();
    } catch (e2) { setFormErr(e2.message || 'تعذّر الحفظ'); }
    finally { setSaving(false); }
  }
  async function del(s) {
    if (!confirm(`حذف المورّد «${s.name}»؟`)) return;
    try { await removeSupplier(s.id); setRows((r) => r.filter((x) => x.id !== s.id)); }
    catch (e2) { setErr(e2.message || 'تعذّر الحذف'); }
  }

  if (!rows) return <Loading />;

  return (
    <>
      <PanelHead icon={IconTruck} title="الموردون">
        <div className="searchbox">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث في الموردين" />
        </div>
        <button className="btn" onClick={openAdd}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          مورّد جديد
        </button>
      </PanelHead>
      <div className="set-body">
      {err && <div className="errbar">{err}</div>}

      <div className="card" style={{ padding: '6px 0' }}>
        {filtered.length === 0 ? (
          <Empty title={q ? 'لا نتائج' : 'لا موردين'} desc={q ? 'جرّب كلمة بحث أخرى.' : 'أضف موردي المواد والمنظمات.'} />
        ) : (
          <table>
            <thead><tr><th>المورّد</th><th>التصنيف</th><th>المدينة</th><th></th></tr></thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td><span className="nm">{s.name}</span></td>
                  <td><span className="src">{s.category || '—'}</span></td>
                  <td>{s.city || '—'}</td>
                  <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                    <button className="btn ghost sm" onClick={() => openEdit(s)}>تعديل</button>
                    <button className="btn ghost sm" style={{ marginInlineStart: 8, color: 'var(--neg)' }} onClick={() => del(s)}>حذف</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <form className="modal-card modal-sm" onSubmit={submit}>
            <div className="modal-head">
              <div><h2>{editing ? 'تعديل مورّد' : 'مورّد جديد'}</h2><p>بيانات المورّد</p></div>
              <button className="icon-close" type="button" onClick={close} aria-label="إغلاق">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            {formErr && <div className="errbar">{formErr}</div>}
            <div className="form-grid">
              <div className="field span-2"><label>اسم المورّد</label><input value={form.name} onChange={(e) => set('name', e.target.value)} required autoFocus /></div>
              <div className="field"><label>التصنيف</label><input value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="تخزين / منظمات / أدوات" /></div>
              <div className="field"><label>المدينة</label><input value={form.city} onChange={(e) => set('city', e.target.value)} /></div>
              <div className="field span-2">
                <label>شعار المورّد</label>
                <div className="upload-row">
                  <label className="btn ghost sm" htmlFor="supplier-logo">رفع اللوجو</label>
                  <input id="supplier-logo" type="file" accept="image/*" hidden onChange={handleLogoFile} />
                  <input value={form.logo_url} onChange={(e) => set('logo_url', e.target.value)} dir="ltr" placeholder="أو الصق رابط الشعار المستضاف" style={{ flex: 1, minWidth: 200 }} />
                </div>
                {(logoPreview || form.logo_url) && (
                  <img className="upload-preview" src={logoPreview || form.logo_url} alt="شعار المورّد" style={{ maxWidth: 140, height: 90, objectFit: 'contain', background: '#fff' }} />
                )}
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" type="button" onClick={close} disabled={saving}>إلغاء</button>
              <button className="btn" type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ المورّد'}</button>
            </div>
          </form>
        </div>
      )}
      </div>
    </>
  );
}

/* ============================ معلومات الشركة ============================ */

function CompanyForm({ row, setRow }) {
  const [form, setForm] = useState(row || {});
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setForm(row || {}); }, [row]);

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

  if (!row) return <Loading />;

  return (
    <>
      <PanelHead icon={IconStore} title="معلومات الشركة" />
      <form className="set-body" onSubmit={submit}>
      <div className="card" style={{ maxWidth: 760 }}>
      {err && <div className="errbar">{err}</div>}
      {saved && <div className="okbar">تم حفظ التغييرات بنجاح ✓</div>}
      <div className="form-grid">
        {FIELDS.map((f) => (
          <div className="field" key={f.k}>
            <label>{f.label}{f.required && ' *'}</label>
            <input type={f.type || 'text'} dir={f.dir || 'rtl'} value={form[f.k] ?? ''} onChange={(e) => set(f.k, e.target.value)} required={f.required} />
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
      </div>
      </form>
    </>
  );
}

/* ============================ الجهات الحكومية ============================ */

const GOV_STATUS = {
  incomplete: { label: 'غير مكتمل', cls: 'p-wait' },
  active: { label: 'نشط', cls: 'p-done' },
  expiring: { label: 'قريب الانتهاء', cls: 'p-prog' },
  expired: { label: 'منتهٍ', cls: 'p-cancel' },
};
const GOV_ORDER = ['البنك', 'بلدي', 'قوى', 'أبشر أعمال', 'وزارة الموارد البشرية', 'مقيم', 'الدفاع المدني (سلامة)', 'هيئة الزكاة والضريبة والجمارك', 'البريد السعودي (سبل)', 'التأمينات الاجتماعية', 'الغرفة التجارية', 'وزارة التجارة'];

function GovPanel({ rows, setRows }) {
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState('');

  const sorted = useMemo(() => {
    if (!rows) return null;
    const rank = (g) => { const i = GOV_ORDER.indexOf(g.entity_name); return i === -1 ? 999 : i; };
    return [...rows].sort((a, b) => rank(a) - rank(b) || a.entity_name.localeCompare(b.entity_name, 'ar'));
  }, [rows]);

  async function attach(g, e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusyId(g.id); setErr('');
    try {
      const url = await uploadGovDocument(file);
      const up = await updateGovernmentAccount(g.id, { doc_url: url });
      setRows((s) => s.map((x) => (x.id === up.id ? up : x)));
    } catch (e2) {
      setErr(e2.message || 'تعذّر رفع المستند');
    } finally {
      setBusyId(null);
    }
  }

  if (!sorted) return <Loading />;

  return (
    <>
      <PanelHead icon={IconBank} title="الجهات الحكومية والرخص">
        <Link className="btn ghost sm" href="/government">فتح إدارة الجهات</Link>
      </PanelHead>
      <div className="set-body">
      {err && <div className="errbar">{err}</div>}
      <div className="card" style={{ padding: '6px 0' }}>
        <table>
          <thead>
            <tr><th>#</th><th>الجهة</th><th>الدخول</th><th>اسم المستخدم</th><th>كلمة المرور</th><th>التواصل</th><th>المستندات</th><th>الانتهاء</th><th>الحالة</th></tr>
          </thead>
          <tbody>
            {sorted.map((g, i) => {
              const st = GOV_STATUS[g.status] || { label: g.status, cls: 'p-wait' };
              return (
                <tr key={g.id}>
                  <td>{fmtNum(i + 1)}</td>
                  <td><span className="nm">{g.entity_name}</span></td>
                  <td>{g.login_url ? <a className="link" href={g.login_url} target="_blank" rel="noreferrer">فتح ↗</a> : '—'}</td>
                  <td dir="ltr" style={{ textAlign: 'start' }}>{g.username || '—'}</td>
                  <td dir="ltr" style={{ textAlign: 'start' }}>{g.secret_ref || '—'}</td>
                  <td>{g.contact || '—'}</td>
                  <td>
                    {g.doc_url ? (
                      <a className="link" href={g.doc_url} target="_blank" rel="noreferrer">📎 عرض</a>
                    ) : (
                      <>
                        <label className="link" htmlFor={`gov-doc-${g.id}`} style={{ cursor: 'pointer' }}>
                          {busyId === g.id ? 'جارٍ الرفع…' : '📎 إرفاق'}
                        </label>
                        <input id={`gov-doc-${g.id}`} type="file" hidden disabled={busyId === g.id} onChange={(e) => attach(g, e)} />
                      </>
                    )}
                  </td>
                  <td>{g.expiry_date ? fmtDate(g.expiry_date) : '—'}</td>
                  <td><span className={`pill ${st.cls}`}>{st.label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>
    </>
  );
}

/* ============================ الفريق والصلاحيات ============================ */

const EMPTY_USER = { email: '', display_name: '', password: '', role: 'viewer', permissions: ROLE_PRESETS.viewer, active: true };
const USER_FILTERS = [
  { key: 'all', label: 'الكل' },
  { key: 'admin', label: 'مدير كامل' },
  { key: 'manager', label: 'مدير عمليات' },
  { key: 'accountant', label: 'محاسب' },
  { key: 'disabled', label: 'معطّل' },
];

function initials(user) {
  const base = (user.display_name || user.email || '؟').trim();
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]);
  return base.slice(0, 2);
}

function UserPermissions({ users, reload }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_USER);
  const [permQ, setPermQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const filtered = useMemo(() => {
    if (!users) return null;
    const term = q.trim();
    return users.filter((u) => {
      if (filter === 'disabled' && u.active !== false) return false;
      if (filter !== 'all' && filter !== 'disabled' && u.role !== filter) return false;
      if (term && !`${u.display_name || ''} ${u.email || ''}`.includes(term)) return false;
      return true;
    });
  }, [users, q, filter]);

  function openAdd() {
    setEditing(null); setForm(EMPTY_USER); setPermQ(''); setMsg(''); setErr(''); setEditorOpen(true);
  }
  function openEdit(user) {
    setEditing(user);
    setForm({
      email: user.email || '', display_name: user.display_name || '', password: '',
      role: user.role || 'viewer', permissions: user.permissions || [],
      active: user.active !== false, user_id: user.user_id,
    });
    setPermQ(''); setMsg(''); setErr(''); setEditorOpen(true);
  }
  function closeEditor() { if (!busy) { setEditorOpen(false); setEditing(null); } }

  function setField(key, value) {
    setForm((current) => {
      if (key === 'role') {
        return { ...current, role: value, permissions: value === 'admin' ? ALL_PERMISSIONS : ROLE_PRESETS[value] || [] };
      }
      return { ...current, [key]: value };
    });
    setMsg(''); setErr('');
  }
  function togglePermission(permission) {
    setForm((current) => {
      const set = new Set(current.permissions || []);
      if (set.has(permission)) set.delete(permission); else set.add(permission);
      return { ...current, permissions: [...set], role: current.role === 'admin' ? 'manager' : current.role };
    });
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(''); setMsg('');
    try {
      // كل عمليات الإنشاء والتعديل تمر عبر API الأدمن (يتكفّل بالتحقق وحماية الأدمن الأساسي)
      const res = await fetch('/api/admin/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const json = await res.json();
        // فولباك عند غياب مفتاح الخدمة: التعديل بلا كلمة مرور يمكن كتابته مباشرة (ينجح للأدمن الأساسي)
        if (editing && !form.password) {
          const { error } = await supabase.from('app_user_access').upsert({
            user_id: form.user_id, email: form.email, display_name: form.display_name || null,
            role: isPrimaryAdmin(form.email) ? 'admin' : form.role,
            permissions: isPrimaryAdmin(form.email) ? ALL_PERMISSIONS : form.permissions,
            active: isPrimaryAdmin(form.email) ? true : form.active,
          }, { onConflict: 'user_id' });
          if (error) throw error;
        } else {
          throw new Error(json.error || 'تعذّر حفظ المستخدم');
        }
      }
      setMsg(editing ? 'تم تحديث صلاحيات المستخدم' : 'تم إنشاء المستخدم وتفعيل صلاحياته');
      await reload();
      setEditorOpen(false); setEditing(null);
    } catch (e2) {
      setErr(e2.message || 'تعذّر حفظ المستخدم');
    } finally { setBusy(false); }
  }

  async function disable(user) {
    if (isPrimaryAdmin(user.email)) return;
    if (!confirm(`تعطيل دخول ${user.email}؟`)) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const res = await fetch(`/api/admin/users?user_id=${encodeURIComponent(user.user_id)}`, {
        method: 'DELETE', headers: await authHeaders(),
      });
      if (!res.ok) {
        // فولباك عند غياب مفتاح الخدمة: تعطيل مباشر (ينجح للأدمن الأساسي عبر RLS)
        const { error } = await supabase.from('app_user_access').update({ active: false }).eq('user_id', user.user_id);
        if (error) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || error.message || 'تعذّر تعطيل المستخدم');
        }
      }
      setMsg('تم تعطيل المستخدم'); await reload();
    } catch (e2) { setErr(e2.message || 'تعذّر تعطيل المستخدم'); }
    finally { setBusy(false); }
  }

  const primaryForm = isPrimaryAdmin(form.email);

  return (
    <>
      <PanelHead icon={IconUsers} title="الفريق والصلاحيات">
        <div className="searchbox">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث باسم أو بريد" />
        </div>
        <button className="btn" onClick={openAdd}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          مستخدم جديد
        </button>
      </PanelHead>
      <div className="set-body">
      <div className="notebar" style={{ background: 'var(--sage-bg)', borderColor: '#bcd4c5', color: '#2c5347' }}>
        رغيد هو الأدمن الأساسي دائماً، ولا يمكن تعطيل حسابه أو إزالة صلاحياته.
      </div>
      {msg && <div className="okbar">{msg}</div>}
      {err && !editorOpen && <div className="errbar">{err}</div>}

      <div className="chiprow">
        {USER_FILTERS.map((f) => (
          <button key={f.key} type="button" className={`fchip${filter === f.key ? ' active' : ''}`} onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>

      <div className="card" style={{ padding: '6px 0' }}>
        {!filtered ? <Loading /> : filtered.length === 0 ? (
          <Empty title="لا مستخدمين" desc="أضف حسابات الفريق وحدّد صلاحياتها." />
        ) : (
          <table>
            <thead><tr><th>المستخدم</th><th>الدور</th><th>الصلاحيات</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {filtered.map((user) => {
                const primary = isPrimaryAdmin(user.email);
                return (
                  <tr key={user.user_id}>
                    <td>
                      <div className="user-cell">
                        <span className="uavatar">{initials(user)}</span>
                        <div>
                          <span className="nm">{user.display_name || user.email}</span>
                          <span className="uid" dir="ltr">{user.email}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      {primary
                        ? <span className="pill p-quote">أدمن أساسي</span>
                        : <span className="src">{ROLE_LABELS[user.role] || user.role}</span>}
                    </td>
                    <td>{primary ? 'الكل' : `${fmtNum(user.permissions?.length || 0)} صلاحية`}</td>
                    <td><span className={`pill ${user.active !== false ? 'p-done' : 'p-cancel'}`}>{user.active !== false ? 'مفعّل' : 'معطّل'}</span></td>
                    <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                      <button className="btn ghost sm" onClick={() => openEdit(user)}>تعديل</button>
                      <button className="btn ghost sm" style={{ marginInlineStart: 8 }} disabled={primary} onClick={() => disable(user)}>تعطيل</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="sec-head" style={{ marginTop: 22 }}>
        <h2>قوالب الأدوار</h2>
        <span className="more" style={{ cursor: 'default' }}>الأساس الذي تُبنى عليه صلاحيات كل مستخدم</span>
      </div>
      <div className="role-cards">
        {Object.entries(ROLE_LABELS).filter(([value]) => value !== 'admin').map(([value, label]) => (
          <div className="role-card" key={value}>
            <div className="rc-name">{label}</div>
            <div className="rc-desc">{fmtNum((ROLE_PRESETS[value] || []).length)} صلاحية</div>
          </div>
        ))}
      </div>

      {editorOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && closeEditor()}>
          <form className="modal-card" onSubmit={submit}>
            <div className="modal-head">
              <div><h2>{editing ? 'تعديل صلاحيات مستخدم' : 'إضافة مستخدم وصلاحيات'}</h2><p>{editing ? form.email : 'حساب جديد للفريق'}</p></div>
              <button className="icon-close" type="button" onClick={closeEditor} aria-label="إغلاق">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            {err && <div className="errbar">{err}</div>}
            <div className="form-grid">
              <div className="field"><label>البريد الإلكتروني</label><input value={form.email} onChange={(e) => setField('email', e.target.value)} dir="ltr" type="email" required disabled={Boolean(editing)} /></div>
              <div className="field"><label>الاسم</label><input value={form.display_name} onChange={(e) => setField('display_name', e.target.value)} /></div>
              <div className="field"><label>{editing ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور'}</label><input value={form.password} onChange={(e) => setField('password', e.target.value)} dir="ltr" type="password" required={!editing} minLength={6} /></div>
              <div className="field"><label>الدور</label>
                <select value={form.role} onChange={(e) => setField('role', e.target.value)} disabled={primaryForm}>
                  {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
            </div>
            <label className="checkline" style={{ marginTop: 8 }}>
              <input type="checkbox" checked={form.active} disabled={primaryForm} onChange={(e) => setField('active', e.target.checked)} />
              <span>الحساب مفعّل</span>
            </label>

            <div className="perm-editor-head">
              <span>الصلاحيات — يملؤها الدور تلقائياً، خصّصها عند الحاجة</span>
              <div className="searchbox sm">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
                <input value={permQ} onChange={(e) => setPermQ(e.target.value)} placeholder="بحث في الصلاحيات" />
              </div>
            </div>
            <div className="permission-groups">
              {PERMISSION_GROUPS.map((group) => {
                const items = group.items.filter((p) => !permQ.trim() || `${p.label} ${p.description}`.includes(permQ.trim()));
                if (items.length === 0) return null;
                return (
                  <div className="permission-group" key={group.group}>
                    <h3>{group.group}</h3>
                    {items.map((permission) => (
                      <label className="permission-check" key={permission.key}>
                        <input
                          type="checkbox"
                          checked={primaryForm || (form.permissions || []).includes(permission.key)}
                          disabled={primaryForm}
                          onChange={() => togglePermission(permission.key)}
                        />
                        <span><b>{permission.label}</b><small>{permission.description}</small></span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
            <div className="modal-actions">
              <button className="btn ghost" type="button" onClick={closeEditor} disabled={busy}>إلغاء</button>
              <button className="btn" type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ الصلاحيات'}</button>
            </div>
          </form>
        </div>
      )}
      </div>
    </>
  );
}

/* ============================ أيقونات ============================ */

function IconTruck() {
  return <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7z" /><circle cx="7.5" cy="18" r="1.6" /><circle cx="17.5" cy="18" r="1.6" /></svg>;
}
function IconUsers() {
  return <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1M16 5a3 3 0 0 1 0 6M21 20v-1a5 5 0 0 0-3-4.5" /></svg>;
}
function IconBank() {
  return <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 21h18M4 10h16M5 10 12 4l7 6M6 10v8M10 10v8M14 10v8M18 10v8" /></svg>;
}
function IconStore() {
  return <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 9h14v11H5zM3.5 9l1.3-4.5h14.4L20.5 9M12 20v-6" /></svg>;
}
