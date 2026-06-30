'use client';
import { useEffect, useState } from 'react';
import { createClient, getClients } from '@/lib/data';
import { fmtNum, CLIENT_STATUS, SOURCE_LABEL } from '@/lib/format';
import { Loading, Empty, ErrorBar } from '../ui';

const EMPTY_FORM = {
  name: '',
  phone: '',
  source: 'instagram',
  district: '',
  status: 'active',
  first_contact_at: '',
  notes: '',
};

export default function ClientsPage() {
  const [clients, setClients] = useState(null);
  const [err, setErr] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');

  useEffect(() => {
    getClients().then(setClients).catch((e) => setErr(e.message || 'تعذّر التحميل'));
  }, []);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setForm(EMPTY_FORM);
    setFormErr('');
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormErr('اسم العميل مطلوب');
      return;
    }
    setSaving(true);
    setFormErr('');
    try {
      const client = await createClient(form);
      setClients((current) => [client, ...(current || [])]);
      closeForm();
    } catch (error) {
      setFormErr(error.message || 'تعذّر حفظ العميل');
    } finally {
      setSaving(false);
    }
  }

  if (err) return <ErrorBar message={err} />;
  if (!clients) return <Loading />;

  return (
    <>
      <div className="sec-head" style={{ marginBottom: 18 }}>
        <button className="btn" onClick={() => setFormOpen(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          عميل جديد
        </button>
        <span className="more" style={{ marginInlineStart: 'auto' }}>{fmtNum(clients.length)} عميلاً</span>
      </div>
      <div className="card" style={{ padding: '6px 0' }}>
        {clients.length === 0 ? (
          <Empty title="لا يوجد عملاء بعد" desc="أضف أول عميل لتظهر بياناته هنا." />
        ) : (
          <table>
            <thead><tr><th>العميل</th><th>الجوال</th><th>المصدر</th><th>الحي</th><th>الحالة</th></tr></thead>
            <tbody>
              {clients.map((c) => {
                const st = CLIENT_STATUS[c.status] || { label: c.status || '—', cls: 'p-wait' };
                return (
                  <tr key={c.id}>
                    <td><span className="nm">{c.name}</span><br /><span className="uid">{c.code || '—'}</span></td>
                    <td className="amt" dir="ltr" style={{ textAlign: 'start' }}>{c.phone || '—'}</td>
                    <td><span className="src">{SOURCE_LABEL[c.source] || c.source || '—'}</span></td>
                    <td>{c.district || '—'}</td>
                    <td><span className={`pill ${st.cls}`}>{st.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {formOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && closeForm()}>
          <form className="modal-card client-form" onSubmit={submit}>
            <div className="modal-head">
              <div>
                <h2>عميل جديد</h2>
                <p>إضافة عميل إلى قاعدة عملاء ترتيب</p>
              </div>
              <button className="icon-close" type="button" onClick={closeForm} aria-label="إغلاق">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>

            {formErr && <div className="errbar">{formErr}</div>}

            <div className="form-grid">
              <div className="field">
                <label>اسم العميل</label>
                <input value={form.name} onChange={(e) => updateField('name', e.target.value)} required autoFocus />
              </div>
              <div className="field">
                <label>رقم الجوال</label>
                <input value={form.phone} onChange={(e) => updateField('phone', e.target.value)} dir="ltr" inputMode="tel" />
              </div>
              <div className="field">
                <label>المصدر</label>
                <select value={form.source} onChange={(e) => updateField('source', e.target.value)}>
                  <option value="instagram">انستقرام</option>
                  <option value="tiktok">تيك توك</option>
                  <option value="referral">توصية صديق</option>
                  <option value="other">أخرى</option>
                </select>
              </div>
              <div className="field">
                <label>الحالة</label>
                <select value={form.status} onChange={(e) => updateField('status', e.target.value)}>
                  <option value="lead">عميل محتمل</option>
                  <option value="active">عميل نشط</option>
                  <option value="waiting">بانتظار رد</option>
                  <option value="completed">مكتمل</option>
                </select>
              </div>
              <div className="field">
                <label>الحي</label>
                <input value={form.district} onChange={(e) => updateField('district', e.target.value)} />
              </div>
              <div className="field">
                <label>تاريخ أول تواصل</label>
                <input type="date" value={form.first_contact_at} onChange={(e) => updateField('first_contact_at', e.target.value)} dir="ltr" />
              </div>
              <div className="field span-2">
                <label>ملاحظات</label>
                <textarea value={form.notes} onChange={(e) => updateField('notes', e.target.value)} rows={3} />
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn ghost" type="button" onClick={closeForm} disabled={saving}>إلغاء</button>
              <button className="btn" type="submit" disabled={saving}>
                {saving ? 'جارٍ الحفظ…' : 'حفظ العميل'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
