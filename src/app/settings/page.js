'use client';
import { useEffect, useState } from 'react';
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
    <form className="card" style={{ maxWidth: 760, margin: '0 auto' }} onSubmit={submit}>
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
  );
}
