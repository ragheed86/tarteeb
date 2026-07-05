'use client';
import { useEffect, useState } from 'react';
import {
  getEmployees, createEmployee, updateEmployee, removeEmployee,
  getEmployeeDocuments, createEmployeeDocument, removeEmployeeDocument,
} from '@/lib/data';
import { fmtNum, fmtDate } from '@/lib/format';
import { Loading, Empty, ErrorBar } from '../ui';

const WAGE = { fixed: 'ثابت', daily: 'يومي', hourly: 'بالساعة' };
const STATUS = { active: { label: 'نشط', cls: 'p-prog' }, on_project: { label: 'في مشروع', cls: 'p-quote' }, inactive: { label: 'غير نشط', cls: 'p-wait' } };
const DOC_TYPE = { national_id: 'هوية وطنية', iqama: 'إقامة', contract: 'عقد', health_cert: 'شهادة صحية', driving_license: 'رخصة قيادة', other: 'أخرى' };

const EMPTY = { name: '', role: '', phone: '', national_id: '', wage: 'fixed', status: 'active', photo_url: '' };

function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}
function expiryCls(d) {
  const n = daysUntil(d);
  if (n === null) return '';
  if (n < 0) return 'p-cancel';
  if (n <= 30) return 'p-prog';
  return 'p-done';
}

export default function EmployeesPage() {
  const [emps, setEmps] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [photoPreview, setPhotoPreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [docFor, setDocFor] = useState(null); // الموظف الذي تُعرض مستنداته

  async function load() {
    try { setEmps(await getEmployees()); } catch (e) { setErr(e.message || 'تعذّر التحميل'); }
  }
  useEffect(() => { load(); }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function openAdd() { setEditing(null); setForm(EMPTY); setPhotoPreview(''); setFormErr(''); setOpen(true); }
  function openEdit(em) {
    setEditing(em);
    setForm({
      name: em.name || '', role: em.role || '', phone: em.phone || '', national_id: em.national_id || '',
      wage: em.wage || 'fixed', status: em.status || 'active', photo_url: em.photo_url || '',
    });
    setPhotoPreview('');
    setFormErr(''); setOpen(true);
  }
  function close() { if (!saving) { setOpen(false); setEditing(null); setPhotoPreview(''); } }

  function handlePhotoFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setFormErr('اسم الموظف مطلوب'); return; }
    setSaving(true); setFormErr('');
    const payload = {
      name: form.name.trim(), role: form.role.trim() || null, phone: form.phone.trim() || null,
      national_id: form.national_id.trim() || null,
      wage: form.wage, status: form.status, photo_url: form.photo_url.trim() || null,
    };
    try {
      if (editing) {
        const up = await updateEmployee(editing.id, payload);
        setEmps((s) => s.map((x) => (x.id === up.id ? up : x)));
      } else {
        const ne = await createEmployee(payload);
        setEmps((s) => [ne, ...s]);
      }
      close();
    } catch (e2) { setFormErr(e2.message || 'تعذّر الحفظ'); }
    finally { setSaving(false); }
  }
  async function del(em) {
    if (!confirm(`حذف الموظف «${em.name}»؟`)) return;
    try { await removeEmployee(em.id); setEmps((s) => s.filter((x) => x.id !== em.id)); }
    catch (e2) { setErr(e2.message || 'تعذّر الحذف'); }
  }

  if (err) return <ErrorBar message={err} />;
  if (!emps) return <Loading />;

  return (
    <>
      <div className="sec-head" style={{ marginBottom: 18 }}>
        <button className="btn" onClick={openAdd}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          موظف جديد
        </button>
        <span className="more" style={{ marginInlineStart: 'auto' }}>{fmtNum(emps.length)} موظف</span>
      </div>

      {emps.length === 0 ? (
        <div className="card"><Empty title="لا موظفين" desc="أضف أعضاء الفريق ومستنداتهم." /></div>
      ) : (
        <div className="pgrid">
          {emps.map((em) => {
            const st = STATUS[em.status] || { label: em.status, cls: 'p-wait' };
            return (
              <div className="pcard employee-card" key={em.id}>
                <div className="employee-photo">
                  {em.photo_url ? (
                    <img src={em.photo_url} alt={em.name} />
                  ) : (
                    <span>{em.name?.trim()?.[0] || '؟'}</span>
                  )}
                </div>
                <div className="pb">
                  <h3>{em.name}</h3>
                  <div className="cl">{em.role || 'بدون دور'}{em.national_id ? ` · هوية/إقامة ${em.national_id}` : ''}</div>
                  <div className="row">
                    <span className={`pill ${st.cls}`}>{st.label}</span>
                    <span>{WAGE[em.wage] || em.wage || '—'}</span>
                  </div>
                  {em.phone && <div className="row" style={{ color: 'var(--muted)', fontSize: 12 }} dir="ltr"><span>{em.phone}</span></div>}
                  <div className="row" style={{ marginTop: 10, gap: 8 }}>
                    <button className="btn ghost sm" onClick={() => setDocFor(em)}>المستندات</button>
                    <button className="btn ghost sm" onClick={() => openEdit(em)}>تعديل</button>
                    <button className="btn ghost sm" style={{ color: 'var(--neg)' }} onClick={() => del(em)}>حذف</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <form className="modal-card" onSubmit={submit}>
            <div className="modal-head">
              <div><h2>{editing ? 'تعديل موظف' : 'موظف جديد'}</h2><p>بيانات عضو الفريق</p></div>
              <button className="icon-close" type="button" onClick={close} aria-label="إغلاق">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            {formErr && <div className="errbar">{formErr}</div>}
            <div className="form-grid">
              <div className="field span-2"><label>الاسم</label><input value={form.name} onChange={(e) => set('name', e.target.value)} required autoFocus /></div>
              <div className="field"><label>الدور</label><input value={form.role} onChange={(e) => set('role', e.target.value)} placeholder="مشرف / فني / محاسب…" /></div>
              <div className="field"><label>الجوال</label><input value={form.phone} onChange={(e) => set('phone', e.target.value)} dir="ltr" inputMode="tel" /></div>
              <div className="field"><label>رقم الهوية/الإقامة</label><input value={form.national_id} onChange={(e) => set('national_id', e.target.value)} dir="ltr" inputMode="numeric" /></div>
              <div className="field"><label>نوع الأجر</label>
                <select value={form.wage} onChange={(e) => set('wage', e.target.value)}>
                  {Object.entries(WAGE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="field"><label>الحالة</label>
                <select value={form.status} onChange={(e) => set('status', e.target.value)}>
                  {Object.entries(STATUS).map(([v, o]) => <option key={v} value={v}>{o.label}</option>)}
                </select>
              </div>
              <div className="field span-2">
                <label>صورة الموظف</label>
                <div className="upload-row">
                  <label className="btn ghost sm" htmlFor="employee-photo">رفع صورة الموظف</label>
                  <input id="employee-photo" type="file" accept="image/*" hidden onChange={handlePhotoFile} />
                  <input
                    value={form.photo_url} onChange={(e) => set('photo_url', e.target.value)} dir="ltr"
                    placeholder="أو الصق رابط الصورة المستضافة" style={{ flex: 1, minWidth: 200 }}
                  />
                </div>
                {(photoPreview || form.photo_url) && (
                  <img className="upload-preview" src={photoPreview || form.photo_url} alt="صورة الموظف" style={{ maxWidth: 140, borderRadius: '50%', aspectRatio: '1/1' }} />
                )}
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" type="button" onClick={close} disabled={saving}>إلغاء</button>
              <button className="btn" type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ الموظف'}</button>
            </div>
          </form>
        </div>
      )}

      {docFor && <DocsModal employee={docFor} onClose={() => setDocFor(null)} />}
    </>
  );
}

function DocsModal({ employee, onClose }) {
  const [docs, setDocs] = useState(null);
  const [form, setForm] = useState({ doc_type: 'iqama', expiry_date: '', file_url: '' });
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() { setDocs(await getEmployeeDocuments(employee.id)); }
  useEffect(() => { load(); }, [employee.id]);

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
  }

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await createEmployeeDocument({
        employee_id: employee.id, doc_type: form.doc_type,
        expiry_date: form.expiry_date || null, file_url: form.file_url.trim() || null,
      });
      setForm({ doc_type: 'iqama', expiry_date: '', file_url: '' });
      setFileName('');
      await load();
    } finally { setBusy(false); }
  }
  async function del(doc) { await removeEmployeeDocument(doc.id); await load(); }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card">
        <div className="modal-head">
          <div><h2>مستندات {employee.name}</h2><p>الهوية والإقامة والعقود مع تنبيهات الانتهاء</p></div>
          <button className="icon-close" type="button" onClick={onClose} aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        {!docs ? <div className="state"><div className="spinner" /></div> : docs.length === 0 ? (
          <Empty title="لا مستندات" desc="أضف أول مستند." />
        ) : (
          <table>
            <thead><tr><th>النوع</th><th>تاريخ الانتهاء</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {docs.map((doc) => {
                const n = daysUntil(doc.expiry_date);
                const label = n === null ? '—' : n < 0 ? 'منتهٍ' : n <= 30 ? `ينتهي خلال ${fmtNum(n)} يوم` : 'ساري';
                return (
                  <tr key={doc.id}>
                    <td>{doc.file_url ? <a href={doc.file_url} target="_blank" rel="noreferrer" style={{ color: 'var(--green)' }}>{DOC_TYPE[doc.doc_type] || doc.doc_type}</a> : (DOC_TYPE[doc.doc_type] || doc.doc_type)}</td>
                    <td>{fmtDate(doc.expiry_date)}</td>
                    <td><span className={`pill ${expiryCls(doc.expiry_date)}`}>{label}</span></td>
                    <td style={{ textAlign: 'left' }}><button className="x-btn" onClick={() => del(doc)}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <form onSubmit={add} className="inline-add" style={{ marginTop: 14, flexWrap: 'wrap' }}>
          <select value={form.doc_type} onChange={(e) => setForm((f) => ({ ...f, doc_type: e.target.value }))} style={{ maxWidth: 150 }}>
            {Object.entries(DOC_TYPE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input type="date" value={form.expiry_date} onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))} dir="ltr" style={{ maxWidth: 160 }} />
          <label className="btn ghost sm" htmlFor="doc-file">رفع المستند</label>
          <input id="doc-file" type="file" hidden onChange={handleFile} />
          {fileName && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{fileName}</span>}
          <input placeholder="أو الصق رابط الملف" dir="ltr" value={form.file_url} onChange={(e) => setForm((f) => ({ ...f, file_url: e.target.value }))} />
          <button className="btn sm" disabled={busy}>إضافة</button>
        </form>
      </div>
    </div>
  );
}
