'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getCompanySettings, updateCompanySettings } from '@/lib/data';
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
        <div>
          <div className="notebar" style={{ background: 'var(--sage-bg)', borderColor: '#bcd4c5', color: '#2c5347' }}>مستويات الوصول مشتقّة تلقائياً من أدوار الموظفين.</div>
          <div className="card">
            {[
              ['المدير العام', 'كل الصلاحيات، الإعدادات، حسابات الشركاء، والتقارير المالية'],
              ['مشرف', 'المشاريع، الفريق، المستودع، والجدولة الميدانية'],
              ['محاسب', 'الفواتير، تكلفة المشاريع، وحسابات الشركاء'],
              ['فني تنظيم', 'المهام المسندة إليه والتوثيق البصري فقط'],
              ['سائق ومساعد', 'الجدول والمهام الميدانية المسندة فقط'],
            ].map(([role, desc]) => <div className="perm" key={role}><span className="pr">{role}</span><span className="pd">{desc}</span></div>)}
          </div>
        </div>
      )}
    </>
  );
}
