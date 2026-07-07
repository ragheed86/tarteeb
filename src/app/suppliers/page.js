'use client';
import { useEffect, useState } from 'react';
import { getSuppliers, createSupplier, updateSupplier, removeSupplier } from '@/lib/data';
import { fmtNum } from '@/lib/format';
import { Loading, Empty, ErrorBar } from '../ui';

const EMPTY = { name: '', category: '', city: '', logo_url: '' };

// يصغّر صورة الشعار ويعيدها كـ data URL يُخزَّن مباشرة في logo_url فلا يضيع
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
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('صورة غير صالحة')); };
    img.src = url;
  });
}

export default function SuppliersPage() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [logoPreview, setLogoPreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');

  async function load() {
    try { setRows(await getSuppliers()); } catch (e) { setErr(e.message || 'تعذّر التحميل'); }
  }
  useEffect(() => { load(); }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function openAdd() { setEditing(null); setForm(EMPTY); setLogoPreview(''); setFormErr(''); setOpen(true); }
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
      else { const ns = await createSupplier(payload); setRows((s) => [ns, ...s]); }
      close();
    } catch (e2) { setFormErr(e2.message || 'تعذّر الحفظ'); }
    finally { setSaving(false); }
  }
  async function del(s) {
    if (!confirm(`حذف المورّد «${s.name}»؟`)) return;
    try { await removeSupplier(s.id); setRows((r) => r.filter((x) => x.id !== s.id)); }
    catch (e2) { setErr(e2.message || 'تعذّر الحذف'); }
  }

  if (err) return <ErrorBar message={err} />;
  if (!rows) return <Loading />;

  return (
    <>
      <div className="sec-head" style={{ marginBottom: 18 }}>
        <button className="btn" onClick={openAdd}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          مورّد جديد
        </button>
        <span className="more" style={{ marginInlineStart: 'auto' }}>{fmtNum(rows.length)} مورّد</span>
      </div>

      <div className="card" style={{ padding: '6px 0' }}>
        {rows.length === 0 ? (
          <Empty title="لا موردين" desc="أضف موردي المواد والمنظمات." />
        ) : (
          <table>
            <thead><tr><th>المورّد</th><th>التصنيف</th><th>المدينة</th><th></th></tr></thead>
            <tbody>
              {rows.map((s) => (
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
          <form className="modal-card" onSubmit={submit}>
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
                  <input
                    value={form.logo_url} onChange={(e) => set('logo_url', e.target.value)} dir="ltr"
                    placeholder="أو الصق رابط الشعار المستضاف" style={{ flex: 1, minWidth: 200 }}
                  />
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
    </>
  );
}
