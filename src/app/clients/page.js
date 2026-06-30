'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient, updateClient, removeClient, getClients } from '@/lib/data';
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

function toForm(c) {
  return {
    name: c.name || '',
    phone: c.phone || '',
    source: c.source || 'instagram',
    district: c.district || '',
    status: c.status || 'active',
    first_contact_at: c.first_contact_at || '',
    notes: c.notes || '',
  };
}

export default function ClientsPage() {
  const [clients, setClients] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = إضافة، كائن = تعديل
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');

  useEffect(() => {
    getClients().then(setClients).catch((e) => setErr(e.message || 'تعذّر التحميل'));
  }, []);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormErr('');
    setFormOpen(true);
  }

  function openEdit(c) {
    setEditing(c);
    setForm(toForm(c));
    setFormErr('');
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setEditing(null);
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
      if (editing) {
        const updated = await updateClient(editing.id, form);
        setClients((current) => (current || []).map((c) => (c.id === updated.id ? updated : c)));
      } else {
        const client = await createClient(form);
        setClients((current) => [client, ...(current || [])]);
      }
      closeForm();
    } catch (error) {
      setFormErr(error.message || 'تعذّر حفظ العميل');
    } finally {
      setSaving(false);
    }
  }

  async function del(c) {
    if (!confirm(`حذف العميل «${c.name}»؟ سيُحذف معه مشاريعه وفواتيره المرتبطة.`)) return;
    try {
      await removeClient(c.id);
      setClients((current) => (current || []).filter((x) => x.id !== c.id));
    } catch (error) {
      setErr(error.message || 'تعذّر الحذف');
    }
  }

  if (err) return <ErrorBar message={err} />;
  if (!clients) return <Loading />;

  const term = q.trim().toLowerCase();
  const filtered = term
    ? clients.filter((c) =>
        [c.name, c.phone, c.district, SOURCE_LABEL[c.source]]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(term)),
      )
    : clients;

  return (
    <>
      <div className="sec-head" style={{ marginBottom: 18 }}>
        <button className="btn" onClick={openAdd}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          عميل جديد
        </button>
        <div className="search" style={{ marginInlineStart: 'auto', width: 260 }}>
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input placeholder="بحث بالاسم أو الجوال أو الحي…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="more">{fmtNum(filtered.length)} عميلاً</span>
      </div>
      <div className="card" style={{ padding: '6px 0' }}>
        {filtered.length === 0 ? (
          clients.length === 0 ? (
            <Empty title="لا يوجد عملاء بعد" desc="أضف أول عميل لتظهر بياناته هنا." />
          ) : (
            <Empty title="لا نتائج" desc={`لا يوجد عميل يطابق «${q}».`} />
          )
        ) : (
          <table>
            <thead><tr><th>العميل</th><th>الجوال</th><th>المصدر</th><th>الحي</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {filtered.map((c) => {
                const st = CLIENT_STATUS[c.status] || { label: c.status || '—', cls: 'p-wait' };
                return (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/clients/${c.id}`} className="nm" style={{ color: 'var(--green)' }}>{c.name}</Link>
                      <br /><span className="uid">{c.code || '—'}</span>
                    </td>
                    <td className="amt" dir="ltr" style={{ textAlign: 'start' }}>{c.phone || '—'}</td>
                    <td><span className="src">{SOURCE_LABEL[c.source] || c.source || '—'}</span></td>
                    <td>{c.district || '—'}</td>
                    <td><span className={`pill ${st.cls}`}>{st.label}</span></td>
                    <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                      <button className="btn ghost sm" onClick={() => openEdit(c)}>تعديل</button>
                      <button className="btn ghost sm" style={{ marginInlineStart: 8, color: 'var(--neg)' }} onClick={() => del(c)}>حذف</button>
                    </td>
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
                <h2>{editing ? 'تعديل عميل' : 'عميل جديد'}</h2>
                <p>{editing ? 'تحديث بيانات العميل' : 'إضافة عميل إلى قاعدة عملاء ترتيب'}</p>
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
                {saving ? 'جارٍ الحفظ…' : editing ? 'حفظ التعديل' : 'حفظ العميل'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
