'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  getCompanySettings, updateCompanySettings,
  getSuppliers, createSupplier, updateSupplier, removeSupplier,
  getServices, createService, updateService, removeService,
  getGovernmentAccounts, updateGovernmentAccount, uploadGovDocument,
} from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { fmtNum, fmtDate } from '@/lib/format';
import { EXPORTABLE, IMPORTABLE, ENTITIES, exportEntity, exportFullBackup, downloadTemplate, readImportFile, importRows } from '@/lib/dataio';
import { toast } from '../toast';
import {
  ALL_PERMISSIONS, PERMISSION_GROUPS, ROLE_LABELS, ROLE_PRESETS, isPrimaryAdmin,
} from '@/lib/permissions';
import { Loading, ErrorBar, Empty, Modal, DataTable, Input, Ltr } from '@/components';

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
    items: [
      { key: 'company', label: 'معلومات الشركة', icon: IconStore },
      { key: 'services', label: 'الخدمات', icon: IconBriefcase, badge: 'services' },
      { key: 'vat', label: 'الضريبة', icon: IconPercent },
    ],
  },
  {
    label: 'النظام',
    items: [{ key: 'data', label: 'الاستيراد والتصدير', icon: IconData }],
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
  const [services, setServices] = useState(null);
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
    getServices().then((r) => setServices(r || [])).catch(() => setServices([]));
    getGovernmentAccounts().then((r) => setGov(r || [])).catch(() => setGov([]));
    loadUsers().catch(() => setUsers([]));
  }, []);

  const counts = { suppliers: suppliers?.length, users: users?.length, gov: gov?.length, services: services?.length };

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
      {tab === 'services' && <ServicesPanel rows={services} setRows={setServices} />}
      {tab === 'vat' && <VatForm row={company} setRow={setCompany} />}
      {tab === 'data' && <ImportExportPanel />}
    </div>
  );
}

/* ============================ الموردون (مضمّن) ============================ */

const EMPTY_SUPPLIER = { name: '', category: '', city: '', logo_url: '' };

// يصغّر صورة الشعار ويعيدها كـ data URL يُخزَّن مباشرة في logo_url (يبقى دائماً بلا حاجة لحاوية تخزين)
function logoFileToDataUrl(file, max = 256) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/png')); // PNG يحافظ على شفافية الشعار
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('صورة غير صالحة')); };
    img.src = url;
  });
}

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
  async function handleLogoFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await logoFileToDataUrl(file);
      set('logo_url', dataUrl); // يُحفظ فعلياً عند الإرسال فلا يضيع
      setLogoPreview(dataUrl);
      setFormErr('');
    } catch { setFormErr('تعذّر معالجة صورة الشعار'); }
  }

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
          <DataTable
            rows={filtered}
            columns={[
              {
                key: 'name', label: 'المورّد', primary: true,
                render: (s) => (
                  <span className="sup-cell">
                    {s.logo_url
                      ? <img className="sup-logo" src={s.logo_url} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                      : <span className="sup-logo sup-logo-fallback">{(s.name || '؟').slice(0, 1)}</span>}
                    <span className="nm">{s.name}</span>
                  </span>
                ),
              },
              { key: 'category', label: 'التصنيف', render: (s) => <span className="src">{s.category || '—'}</span> },
              { key: 'city', label: 'المدينة', render: (s) => s.city || '—' },
              {
                key: 'actions', label: '', align: 'left',
                render: (s) => (
                  <>
                    <button className="btn ghost sm" onClick={() => openEdit(s)}>تعديل</button>
                    <button className="btn ghost sm" style={{ marginInlineStart: 8, color: 'var(--neg)' }} onClick={() => del(s)}>حذف</button>
                  </>
                ),
              },
            ]}
          />
        )}
      </div>

      <Modal
        open={open}
        onClose={close}
        size="sm"
        title={editing ? 'تعديل مورّد' : 'مورّد جديد'}
        subtitle="بيانات المورّد"
        as="form"
        onSubmit={submit}
        footer={(
          <>
            <button className="btn ghost" type="button" onClick={close} disabled={saving}>إلغاء</button>
            <button className="btn" type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ المورّد'}</button>
          </>
        )}
      >
        {formErr && <div className="errbar">{formErr}</div>}
        <div className="form-grid">
          <Input className="span-2" label="اسم المورّد" value={form.name} onChange={(e) => set('name', e.target.value)} required autoFocus />
          <Input label="التصنيف" value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="تخزين / منظمات / أدوات" />
          <Input label="المدينة" value={form.city} onChange={(e) => set('city', e.target.value)} />
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
      </Modal>
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

/* ============================ الخدمات ============================ */

const EMPTY_SERVICE = { name: '', description: '', default_rate: '', vat_rate: '', active: true };

function ServicesPanel({ rows, setRows }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_SERVICE);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [err, setErr] = useState('');

  const filtered = useMemo(() => {
    if (!rows) return null;
    const term = q.trim();
    if (!term) return rows;
    return rows.filter((s) => `${s.name} ${s.description || ''}`.includes(term));
  }, [rows, q]);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function openAdd() { setEditing(null); setForm(EMPTY_SERVICE); setFormErr(''); setOpen(true); }
  function openEdit(s) {
    setEditing(s);
    setForm({ name: s.name || '', description: s.description || '', default_rate: s.default_rate ?? '', vat_rate: s.vat_rate ?? '', active: s.active !== false });
    setFormErr(''); setOpen(true);
  }
  function close() { if (!saving) { setOpen(false); setEditing(null); } }

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setFormErr('اسم الخدمة مطلوب'); return; }
    const rate = Number(form.default_rate);
    if (!Number.isFinite(rate) || rate < 0) { setFormErr('التكلفة/اليوم يجب أن تكون رقماً صفراً أو أكبر'); return; }
    const vat = form.vat_rate === '' || form.vat_rate == null ? null : Number(form.vat_rate);
    if (vat != null && (!Number.isFinite(vat) || vat < 0 || vat > 99.99)) { setFormErr('نسبة الضريبة يجب أن تكون بين 0 و99.99'); return; }
    setSaving(true); setFormErr('');
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      default_rate: rate,
      vat_rate: vat,
      active: !!form.active,
    };
    try {
      if (editing) { const up = await updateService(editing.id, payload); setRows((s) => s.map((x) => (x.id === up.id ? up : x))); }
      else { const ns = await createService(payload); setRows((s) => [...(s || []), ns]); }
      close();
    } catch (e2) { setFormErr(e2.message || 'تعذّر الحفظ'); }
    finally { setSaving(false); }
  }
  async function toggleActive(s) {
    try { const up = await updateService(s.id, { active: !s.active }); setRows((r) => r.map((x) => (x.id === up.id ? up : x))); }
    catch (e2) { setErr(e2.message || 'تعذّر التحديث'); }
  }
  async function del(s) {
    if (!confirm(`حذف الخدمة «${s.name}»؟ البنود المكتوبة سابقاً في العروض والفواتير لن تتأثر.`)) return;
    try { await removeService(s.id); setRows((r) => r.filter((x) => x.id !== s.id)); }
    catch (e2) { setErr(e2.message || 'تعذّر الحذف'); }
  }

  if (!rows) return <Loading />;

  return (
    <>
      <PanelHead icon={IconBriefcase} title="الخدمات">
        <div className="searchbox">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث في الخدمات" />
        </div>
        <button className="btn" onClick={openAdd}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          خدمة جديدة
        </button>
      </PanelHead>
      <div className="set-body">
      {err && <div className="errbar">{err}</div>}

      <div className="card" style={{ padding: '6px 0' }}>
        {filtered.length === 0 ? (
          <Empty title={q ? 'لا نتائج' : 'لا خدمات'} desc={q ? 'جرّب كلمة بحث أخرى.' : 'أضف خدماتك لتختارها بنقرة في عروض الأسعار والفواتير.'} />
        ) : (
          <DataTable
            rows={filtered}
            columns={[
              {
                key: 'name', label: 'الخدمة', primary: true,
                render: (s) => (
                  <span className="sup-cell">
                    <span className="nm">{s.name}</span>
                    {s.description && <span className="src" style={{ display: 'block', fontSize: 12 }}>{s.description}</span>}
                  </span>
                ),
              },
              { key: 'default_rate', label: 'التكلفة/يوم', render: (s) => <Ltr>{fmtNum(s.default_rate)} ⃁</Ltr> },
              { key: 'vat_rate', label: 'الضريبة', render: (s) => (s.vat_rate == null ? 'الافتراضية' : <Ltr>{fmtNum(s.vat_rate)}%</Ltr>) },
              {
                key: 'active', label: 'الحالة',
                render: (s) => (
                  <button className={`pill ${s.active ? 'p-done' : 'p-cancel'}`} style={{ cursor: 'pointer', border: 'none' }} onClick={() => toggleActive(s)} title="اضغط للتبديل">
                    {s.active ? 'نشطة' : 'موقوفة'}
                  </button>
                ),
              },
              {
                key: 'actions', label: '', align: 'left',
                render: (s) => (
                  <>
                    <button className="btn ghost sm" onClick={() => openEdit(s)}>تعديل</button>
                    <button className="btn ghost sm" style={{ marginInlineStart: 8, color: 'var(--neg)' }} onClick={() => del(s)}>حذف</button>
                  </>
                ),
              },
            ]}
          />
        )}
      </div>

      <Modal
        open={open}
        onClose={close}
        title={editing ? 'تعديل الخدمة' : 'خدمة جديدة'}
        as="form"
        onSubmit={submit}
        footer={(
          <>
            <button className="btn ghost" type="button" onClick={close} disabled={saving}>إلغاء</button>
            <button className="btn" type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ الخدمة'}</button>
          </>
        )}
      >
        {formErr && <div className="errbar">{formErr}</div>}
        <div className="form-grid">
          <Input className="span-2" label="اسم الخدمة" value={form.name} onChange={(e) => set('name', e.target.value)} required autoFocus />
          <div className="field span-2">
            <label>الوصف (اختياري)</label>
            <textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
          </div>
          <div className="field">
            <label>التكلفة/اليوم *</label>
            <input type="number" dir="ltr" min="0" step="0.01" value={form.default_rate} onChange={(e) => set('default_rate', e.target.value)} required />
          </div>
          <div className="field">
            <label>نسبة الضريبة (%) — اتركها فارغة للافتراضية</label>
            <input type="number" dir="ltr" min="0" max="99.99" step="0.01" value={form.vat_rate} onChange={(e) => set('vat_rate', e.target.value)} />
          </div>
          <div className="field span-2">
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!form.active} onChange={(e) => set('active', e.target.checked)} style={{ width: 'auto' }} />
              نشطة (تظهر في اقتراحات العروض والفواتير)
            </label>
          </div>
        </div>
      </Modal>
      </div>
    </>
  );
}

/* ============================ الضريبة ============================ */

function VatForm({ row, setRow }) {
  const [form, setForm] = useState(row || {});
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setForm(row || {}); }, [row]);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); setSaved(false); }

  async function submit(e) {
    e.preventDefault();
    const rate = form.default_vat_rate === '' || form.default_vat_rate == null ? null : Number(form.default_vat_rate);
    if (rate != null && (!Number.isFinite(rate) || rate < 0 || rate > 99.99)) { setErr('النسبة الافتراضية يجب أن تكون بين 0 و99.99'); return; }
    setSaving(true); setErr('');
    try {
      const up = await updateCompanySettings(row.id, {
        vat_enabled: !!form.vat_enabled,
        default_vat_rate: rate,
        vat_exemption_note_ar: (form.vat_exemption_note_ar ?? '').trim() || null,
      });
      setRow(up); setForm(up); setSaved(true);
    } catch (e2) { setErr(e2.message || 'تعذّر الحفظ'); }
    finally { setSaving(false); }
  }

  if (!row) return <Loading />;

  return (
    <>
      <PanelHead icon={IconPercent} title="الضريبة" />
      <form className="set-body" onSubmit={submit}>
      <div className="card" style={{ maxWidth: 760 }}>
      {err && <div className="errbar">{err}</div>}
      {saved && <div className="okbar">تم حفظ التغييرات بنجاح ✓</div>}
      <div className="form-grid">
        <div className="field span-2">
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form.vat_enabled} onChange={(e) => set('vat_enabled', e.target.checked)} style={{ width: 'auto' }} />
            تفعيل ضريبة القيمة المضافة على عروض الأسعار
          </label>
          <p style={{ fontSize: 12, color: 'var(--tx-3, #7A8A92)', margin: '6px 0 0' }}>
            عند التعطيل (المنشأة معفاة حالياً) لا يظهر أي سطر ضريبة في عروض الأسعار، ويمكن تجاوز ذلك لكل عرض من داخل المولّد. لا يؤثر هذا الإعداد على الفواتير.
          </p>
        </div>
        <div className="field">
          <label>النسبة الافتراضية (%)</label>
          <input type="number" dir="ltr" step="0.01" min="0" max="99.99" value={form.default_vat_rate ?? ''} onChange={(e) => set('default_vat_rate', e.target.value)} />
        </div>
        <div className="field span-2">
          <label>ملاحظة الإعفاء (تظهر أسفل عرض السعر عند عدم تطبيق الضريبة)</label>
          <textarea rows={2} value={form.vat_exemption_note_ar ?? ''} onChange={(e) => set('vat_exemption_note_ar', e.target.value)} placeholder="مثال: المنشأة غير خاضعة لضريبة القيمة المضافة." />
        </div>
      </div>
      <div className="modal-actions" style={{ marginTop: 18 }}>
        <button className="btn" type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}</button>
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
  const [logoBusyId, setLogoBusyId] = useState(null);
  const [err, setErr] = useState('');

  const sorted = useMemo(() => {
    if (!rows) return null;
    const rank = (g) => { const i = GOV_ORDER.indexOf(g.entity_name); return i === -1 ? 999 : i; };
    return [...rows].sort((a, b) => rank(a) - rank(b) || a.entity_name.localeCompare(b.entity_name, 'ar'));
  }, [rows]);

  // شعار الجهة: يُصغَّر إلى data URL ويُحفظ في logo_url فلا يضيع (نفس مبدأ الموردين)
  async function setLogo(g, e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLogoBusyId(g.id); setErr('');
    try {
      const dataUrl = await logoFileToDataUrl(file);
      const up = await updateGovernmentAccount(g.id, { logo_url: dataUrl });
      setRows((s) => s.map((x) => (x.id === up.id ? up : x)));
    } catch (e2) {
      setErr(e2.message || 'تعذّر رفع الشعار');
    } finally {
      setLogoBusyId(null);
    }
  }

  async function attach(g, e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusyId(g.id); setErr('');
    try {
      const uploaded = await uploadGovDocument(file);
      const up = await updateGovernmentAccount(g.id, { doc_url: null, doc_path: uploaded.path });
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
        <DataTable
          rows={sorted}
          columns={[
            { key: 'idx', label: '#', hideMobile: true, render: (g, i) => fmtNum(i + 1) },
            {
              key: 'entity_name', label: 'الجهة', primary: true,
              render: (g) => (
                <span className="sup-cell">
                  <label className="gov-logo-pick" htmlFor={`gov-logo-${g.id}`} title="اضغط لتغيير شعار الجهة">
                    {g.logo_url
                      ? <img className="sup-logo" src={g.logo_url} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                      : <span className="sup-logo sup-logo-fallback">{logoBusyId === g.id ? '…' : (g.entity_name || '؟').slice(0, 1)}</span>}
                    <input id={`gov-logo-${g.id}`} type="file" accept="image/*" hidden disabled={logoBusyId === g.id} onChange={(e) => setLogo(g, e)} />
                  </label>
                  <span className="nm">{g.entity_name}</span>
                </span>
              ),
            },
            { key: 'login', label: 'الدخول', render: (g) => (g.login_url ? <a className="link" href={g.login_url} target="_blank" rel="noreferrer">فتح ↗</a> : '—') },
            { key: 'username', label: 'اسم المستخدم', render: (g) => <Ltr>{g.username || '—'}</Ltr> },
            { key: 'secret_ref', label: 'مرجع السر', render: (g) => <Ltr>{g.secret_ref || '—'}</Ltr> },
            { key: 'contact', label: 'التواصل', render: (g) => g.contact || '—' },
            {
              key: 'docs', label: 'المستندات',
              render: (g) => (g.doc_url ? (
                <a className="link" href={g.doc_url} target="_blank" rel="noreferrer">📎 عرض</a>
              ) : (
                <>
                  <label className="link" htmlFor={`gov-doc-${g.id}`} style={{ cursor: 'pointer' }}>
                    {busyId === g.id ? 'جارٍ الرفع…' : '📎 إرفاق'}
                  </label>
                  <input id={`gov-doc-${g.id}`} type="file" hidden disabled={busyId === g.id} onChange={(e) => attach(g, e)} />
                </>
              )),
            },
            { key: 'expiry_date', label: 'الانتهاء', render: (g) => (g.expiry_date ? fmtDate(g.expiry_date) : '—') },
            {
              key: 'status', label: 'الحالة',
              render: (g) => { const st = GOV_STATUS[g.status] || { label: g.status, cls: 'p-wait' }; return <span className={`pill ${st.cls}`}>{st.label}</span>; },
            },
          ]}
        />
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
      <div className="notebar" style={{ background: 'var(--sage-bg)', borderColor: 'var(--teal-200)', color: 'var(--teal-800)' }}>
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
          <DataTable
            rows={filtered}
            rowKey={(user) => user.user_id}
            columns={[
              {
                key: 'user', label: 'المستخدم', primary: true,
                render: (user) => (
                  <div className="user-cell">
                    <span className="uavatar">{initials(user)}</span>
                    <div>
                      <span className="nm">{user.display_name || user.email}</span>
                      <span className="uid" dir="ltr">{user.email}</span>
                    </div>
                  </div>
                ),
              },
              {
                key: 'role', label: 'الدور',
                render: (user) => (isPrimaryAdmin(user.email)
                  ? <span className="pill p-quote">أدمن أساسي</span>
                  : <span className="src">{ROLE_LABELS[user.role] || user.role}</span>),
              },
              { key: 'permissions', label: 'الصلاحيات', render: (user) => (isPrimaryAdmin(user.email) ? 'الكل' : `${fmtNum(user.permissions?.length || 0)} صلاحية`) },
              { key: 'active', label: 'الحالة', render: (user) => <span className={`pill ${user.active !== false ? 'p-done' : 'p-cancel'}`}>{user.active !== false ? 'مفعّل' : 'معطّل'}</span> },
              {
                key: 'actions', label: '', align: 'left',
                render: (user) => {
                  const primary = isPrimaryAdmin(user.email);
                  return (
                    <>
                      <button className="btn ghost sm" onClick={() => openEdit(user)}>تعديل</button>
                      <button className="btn ghost sm" style={{ marginInlineStart: 8 }} disabled={primary} onClick={() => disable(user)}>تعطيل</button>
                    </>
                  );
                },
              },
            ]}
          />
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

      <Modal
        open={editorOpen}
        onClose={closeEditor}
        title={editing ? 'تعديل صلاحيات مستخدم' : 'إضافة مستخدم وصلاحيات'}
        subtitle={editing ? form.email : 'حساب جديد للفريق'}
        as="form"
        onSubmit={submit}
        footer={(
          <>
            <button className="btn ghost" type="button" onClick={closeEditor} disabled={busy}>إلغاء</button>
            <button className="btn" type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ الصلاحيات'}</button>
          </>
        )}
      >
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
      </Modal>
      </div>
    </>
  );
}

/* ============================ الاستيراد والتصدير ============================ */

function ImportExportPanel() {
  const [expEntity, setExpEntity] = useState('clients');
  const [expBusy, setExpBusy] = useState(false);

  const [impEntity, setImpEntity] = useState('clients');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null); // { rows, error }
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);

  async function doExport(format) {
    setExpBusy(true);
    try {
      const n = await exportEntity(expEntity, format);
      toast(`صُدّر ${fmtNum(n)} سجلاً`);
    } catch (e) {
      toast(e.message || 'تعذّر التصدير', 'err');
    } finally { setExpBusy(false); }
  }

  async function doBackup() {
    setExpBusy(true);
    try {
      await exportFullBackup();
      toast('تم تنزيل النسخة الاحتياطية الكاملة');
    } catch (e) {
      toast(e.message || 'تعذّر إنشاء النسخة', 'err');
    } finally { setExpBusy(false); }
  }

  async function onFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    setResult(null); setProgress(0);
    if (!f) { setFile(null); setPreview(null); return; }
    setFile(f);
    try {
      const rows = await readImportFile(f, impEntity);
      setPreview({ rows, error: '' });
    } catch (e2) {
      setPreview({ rows: [], error: e2.message || 'تعذّر قراءة الملف' });
    }
  }

  async function runImport() {
    if (!preview?.rows?.length) return;
    setImporting(true); setResult(null); setProgress(0);
    try {
      const res = await importRows(impEntity, preview.rows, {
        onProgress: (done, total) => setProgress(Math.round((done / total) * 100)),
      });
      setResult(res);
      setFile(null); setPreview(null);
      if (res.added > 0) toast(`أُضيف ${fmtNum(res.added)} سجلاً`);
      else if (res.errors.length) toast('لم يُضف أي سجل — راجع الأخطاء', 'err');
      else toast('كل السجلات موجودة مسبقاً');
    } catch (e) {
      toast(e.message || 'تعذّر الاستيراد', 'err');
    } finally { setImporting(false); }
  }

  return (
    <>
      <PanelHead icon={IconData} title="الاستيراد والتصدير" />
      <div className="set-body">
        <div className="notebar">صدّر بياناتك إلى CSV (يفتح في Excel) أو JSON، أو استورد دفعة من ملف. الاستيراد يتحقق من الحقول ويتجاوز المكرّر تلقائياً.</div>

        {/* التصدير */}
        <div className="card">
          <div className="sec-head"><h2>تصدير البيانات</h2></div>
          <div className="io-row">
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label>الجدول المراد تصديره</label>
              <select value={expEntity} onChange={(e) => setExpEntity(e.target.value)}>
                {EXPORTABLE.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
            <button className="btn" type="button" disabled={expBusy} onClick={() => doExport('csv')}>تنزيل CSV</button>
            <button className="btn ghost" type="button" disabled={expBusy} onClick={() => doExport('json')}>تنزيل JSON</button>
          </div>
          <div className="io-divider" />
          <div className="io-row">
            <div style={{ flex: 1, minWidth: 200 }}>
              <b style={{ fontSize: 14 }}>نسخة احتياطية كاملة</b>
              <div className="note" style={{ textAlign: 'start', marginTop: 2 }}>كل الجداول في ملف JSON واحد.</div>
            </div>
            <button className="btn ghost" type="button" disabled={expBusy} onClick={doBackup}>تنزيل نسخة كاملة</button>
          </div>
        </div>

        {/* الاستيراد */}
        <div className="card" style={{ marginTop: 16 }}>
          <div className="sec-head"><h2>استيراد البيانات</h2></div>
          <div className="io-row">
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label>الجدول المستهدف</label>
              <select value={impEntity} onChange={(e) => { setImpEntity(e.target.value); setFile(null); setPreview(null); setResult(null); }}>
                {IMPORTABLE.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
            <button className="btn ghost" type="button" onClick={() => downloadTemplate(impEntity, 'csv')}>تحميل القالب (CSV)</button>
            <label className="btn ghost" htmlFor="io-file" style={{ cursor: 'pointer' }}>{file ? 'تغيير الملف' : 'اختيار ملف CSV/JSON'}</label>
            <input id="io-file" type="file" accept=".csv,.json,text/csv,application/json" hidden onChange={onFile} />
          </div>

          <div className="note" style={{ textAlign: 'start' }}>
            نزّل القالب المعتمد، عبّئه (استبدل الصف التوضيحي ببياناتك)، ثم ارفعه هنا.
            {' '}الأعمدة المتوقعة: {ENTITIES[impEntity].columns.map((c) => c.label).join('، ')}.
          </div>

          {file && preview && !preview.error && (
            <div className="io-preview">
              <b>{file.name}</b> — {fmtNum(preview.rows.length)} صف جاهز للاستيراد.
            </div>
          )}
          {preview?.error && <div className="errbar" style={{ marginTop: 12 }}>{preview.error}</div>}

          {importing && (
            <div className="io-progress">
              <div className="io-track"><div className="io-track-fill" style={{ width: `${progress}%` }} /></div>
              <span>{fmtNum(progress)}%</span>
            </div>
          )}

          {preview?.rows?.length > 0 && !preview.error && (
            <div className="modal-actions" style={{ marginTop: 14 }}>
              <button className="btn" type="button" disabled={importing} onClick={runImport}>
                {importing ? 'جارٍ الاستيراد…' : `استيراد ${fmtNum(preview.rows.length)} صف`}
              </button>
            </div>
          )}

          {result && (
            <div className="io-result">
              <div className="io-stats">
                <span className="io-stat ok">أُضيف: {fmtNum(result.added)}</span>
                <span className="io-stat skip">مكرّر متجاوَز: {fmtNum(result.skipped)}</span>
                <span className="io-stat err">أخطاء: {fmtNum(result.errors.length)}</span>
              </div>
              {result.errors.length > 0 && (
                <ul className="io-errors">
                  {result.errors.slice(0, 12).map((msg, i) => <li key={i}>{msg}</li>)}
                  {result.errors.length > 12 && <li>… و{fmtNum(result.errors.length - 12)} خطأ آخر</li>}
                </ul>
              )}
            </div>
          )}
        </div>
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
function IconBriefcase() {
  return <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" /></svg>;
}
function IconPercent() {
  return <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M19 5 5 19" /><circle cx="7.5" cy="7.5" r="2.5" /><circle cx="16.5" cy="16.5" r="2.5" /></svg>;
}
function IconData() {
  return <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>;
}
