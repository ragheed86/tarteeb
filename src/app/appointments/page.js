'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  getAppointments, createAppointment, updateAppointment, removeAppointment,
  setAppointmentAttendees, getEmployeesBasic,
} from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { GREGORIAN_DATE_LOCALE, fmtDate } from '@/lib/format';
import { Loading, Empty, ErrorBar, Modal, DataTable, Input, TextArea } from '@/components';
import { toast } from '@/app/toast';

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${data.session?.access_token || ''}`, 'Content-Type': 'application/json' };
}
async function syncAppointment(appointmentId, deleted = false) {
  try {
    const res = await fetch('/api/appointments/sync', {
      method: 'POST', headers: await authHeaders(),
      body: JSON.stringify({ appointment_id: appointmentId, deleted }),
    });
    if (!res.ok) { const p = await res.json().catch(() => ({})); throw new Error(p.error); }
  } catch (e) {
    toast(e.message || 'تعذّرت مزامنة الموعد مع Google Calendar', 'err');
  }
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toLocalDate(iso) {
  return iso ? iso.slice(0, 10) : '';
}
function fmtRange(a) {
  if (a.all_day) {
    const s = fmtDate(a.starts_at); const e = fmtDate(a.ends_at);
    return s === e ? `${s} · طوال اليوم` : `${s} → ${e} · طوال اليوم`;
  }
  const opts = { hour: '2-digit', minute: '2-digit' };
  const time = (d) => new Intl.DateTimeFormat(GREGORIAN_DATE_LOCALE, opts).format(new Date(d));
  const sameDay = a.starts_at.slice(0, 10) === a.ends_at.slice(0, 10);
  return sameDay ? `${fmtDate(a.starts_at)} · ${time(a.starts_at)} - ${time(a.ends_at)}` : `${fmtDate(a.starts_at)} ${time(a.starts_at)} → ${fmtDate(a.ends_at)} ${time(a.ends_at)}`;
}

const today = () => new Date().toISOString().slice(0, 10);
const EMPTY_FORM = { title: '', description: '', location: '', all_day: false, start_date: today(), end_date: today(), start_time: '09:00', end_time: '10:00', attendee_ids: [] };

export default function AppointmentsPage() {
  const [rows, setRows] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [connections, setConnections] = useState([]);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [pickEmployee, setPickEmployee] = useState('');

  async function load() {
    try {
      const [appointments, emps] = await Promise.all([getAppointments(), getEmployeesBasic()]);
      setRows(appointments); setEmployees(emps);
      const res = await fetch('/api/google-calendar/status', { headers: await authHeaders() });
      if (res.ok) { const p = await res.json(); setConnections(p.connections || []); }
    } catch (e) { setErr(e.message || 'تعذّر تحميل المواعيد'); }
  }
  useEffect(() => { load(); }, []);

  const connectedIds = useMemo(() => new Set(connections.map((c) => c.employee_id)), [connections]);
  const employeeName = (id) => employees.find((e) => e.id === id)?.name || '—';

  function setF(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function close() { if (!saving) { setOpen(false); setEditing(null); setPickEmployee(''); } }
  function add() { setEditing(null); setForm({ ...EMPTY_FORM, start_date: today(), end_date: today() }); setFormErr(''); setPickEmployee(''); setOpen(true); }
  function edit(a) {
    setEditing(a);
    setForm({
      title: a.title || '', description: a.description || '', location: a.location || '',
      all_day: a.all_day, start_date: toLocalDate(a.starts_at), end_date: toLocalDate(a.ends_at),
      start_time: toLocalInput(a.starts_at).slice(11) || '09:00', end_time: toLocalInput(a.ends_at).slice(11) || '10:00',
      attendee_ids: (a.appointment_attendees || []).map((x) => x.employee_id),
    });
    setFormErr(''); setPickEmployee(''); setOpen(true);
  }
  function addAttendee() {
    if (!pickEmployee || form.attendee_ids.includes(pickEmployee)) return;
    setF('attendee_ids', [...form.attendee_ids, pickEmployee]); setPickEmployee('');
  }
  function removeAttendee(id) { setF('attendee_ids', form.attendee_ids.filter((x) => x !== id)); }

  async function submit(e) {
    e.preventDefault();
    if (!form.title.trim()) { setFormErr('عنوان الموعد مطلوب'); return; }
    const starts_at = form.all_day ? `${form.start_date}T00:00:00` : `${form.start_date}T${form.start_time}:00`;
    const ends_at = form.all_day ? `${form.end_date}T00:00:00` : `${form.end_date}T${form.end_time}:00`;
    if (new Date(ends_at) < new Date(starts_at)) { setFormErr('موعد النهاية يجب أن يكون بعد موعد البداية'); return; }
    setSaving(true); setFormErr('');
    const payload = {
      title: form.title.trim(), description: form.description.trim() || null, location: form.location.trim() || null,
      all_day: form.all_day, starts_at: new Date(starts_at).toISOString(), ends_at: new Date(ends_at).toISOString(),
    };
    try {
      const saved = editing ? await updateAppointment(editing.id, payload) : await createAppointment(payload);
      await setAppointmentAttendees(saved.id, form.attendee_ids);
      await syncAppointment(saved.id);
      close(); toast(editing ? 'تم تحديث الموعد' : 'تمت إضافة الموعد'); load();
    } catch (e2) { setFormErr(e2.message || 'تعذّر الحفظ'); }
    finally { setSaving(false); }
  }
  async function del(a) {
    if (!confirm(`حذف موعد «${a.title}»؟`)) return;
    try {
      await syncAppointment(a.id, true);
      await removeAppointment(a.id);
      setRows((all) => all.filter((x) => x.id !== a.id)); toast('تم حذف الموعد');
    } catch (e) { toast(e.message || 'تعذّر الحذف', 'err'); }
  }

  if (err) return <ErrorBar message={err} />;
  if (!rows) return <Loading />;

  return (
    <>
      <style>{CSS}</style>
      <div className="sec-head appt-head">
        <div><h2>المواعيد</h2><p>اجتماعات ومواعيد الفريق — تُزامَن تلقائياً مع تقويم Google لكل حاضر متصل</p></div>
        <button className="btn" onClick={add}>+ موعد جديد</button>
      </div>

      <div className="card" style={{ padding: '6px 0' }}>
        <DataTable rows={rows} empty={<Empty title="لا توجد مواعيد" desc="أضف أول اجتماع أو موعد." />} columns={[
          { key: 'title', label: 'الموعد', primary: true, render: (a) => <><span className="nm">{a.title}</span>{a.location && <><br /><small>{a.location}</small></>}</> },
          { key: 'when', label: 'الوقت', render: (a) => fmtRange(a) },
          {
            key: 'attendees', label: 'الحضور', render: (a) => (
              <div className="appt-attendees">
                {(a.appointment_attendees || []).length === 0 ? <span style={{ color: 'var(--muted)' }}>—</span> : a.appointment_attendees.map((x) => (
                  <span key={x.employee_id} className={`chip sm${connectedIds.has(x.employee_id) ? ' linked' : ''}`} title={connectedIds.has(x.employee_id) ? 'متصل بتقويم Google' : 'غير مرتبط بتقويم Google'}>
                    {x.employees?.name || employeeName(x.employee_id)}
                  </span>
                ))}
              </div>
            ),
          },
          { key: 'actions', label: '', align: 'left', render: (a) => <div className="row-actions"><button className="btn ghost sm" onClick={() => edit(a)}>تعديل</button><button className="btn ghost sm danger-text" onClick={() => del(a)}>حذف</button></div> },
        ]} />
      </div>

      <Modal
        open={open} onClose={close} title={editing ? 'تعديل موعد' : 'موعد جديد'}
        subtitle="يُزامَن تلقائياً مع تقويم Google لكل حاضر مرتبط حسابه" as="form" onSubmit={submit}
        footer={<><button type="button" className="btn ghost" onClick={close} disabled={saving}>إلغاء</button><button className="btn" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ الموعد'}</button></>}
      >
        {formErr && <div className="errbar">{formErr}</div>}
        <div className="form-grid">
          <Input className="span-2" label="العنوان" value={form.title} onChange={(e) => setF('title', e.target.value)} required autoFocus />
          <Input className="span-2" label="المكان" value={form.location} onChange={(e) => setF('location', e.target.value)} placeholder="اختياري" />
          <label className="field appt-allday"><span>طوال اليوم</span><input type="checkbox" checked={form.all_day} onChange={(e) => setF('all_day', e.target.checked)} /></label>
          {form.all_day ? (
            <>
              <Input label="من تاريخ" type="date" ltr value={form.start_date} onChange={(e) => setF('start_date', e.target.value)} required />
              <Input label="إلى تاريخ" type="date" ltr value={form.end_date} onChange={(e) => setF('end_date', e.target.value)} required />
            </>
          ) : (
            <>
              <Input label="البداية" type="date" ltr value={form.start_date} onChange={(e) => setF('start_date', e.target.value)} required />
              <Input label="وقت البداية" type="time" ltr value={form.start_time} onChange={(e) => setF('start_time', e.target.value)} required />
              <Input label="النهاية" type="date" ltr value={form.end_date} onChange={(e) => setF('end_date', e.target.value)} required />
              <Input label="وقت النهاية" type="time" ltr value={form.end_time} onChange={(e) => setF('end_time', e.target.value)} required />
            </>
          )}
          <TextArea className="span-2" label="ملاحظات" value={form.description} onChange={(e) => setF('description', e.target.value)} rows="3" />

          <div className="field span-2">
            <label>الحضور</label>
            {form.attendee_ids.length === 0 ? <p className="appt-noattendee">لا حضور بعد</p> : (
              <div className="chips">
                {form.attendee_ids.map((id) => (
                  <span className="chip" key={id}>
                    {employeeName(id)}{!connectedIds.has(id) && <small className="appt-warn"> · بلا تقويم مرتبط</small>}
                    <button type="button" onClick={() => removeAttendee(id)} aria-label="إزالة">✕</button>
                  </span>
                ))}
              </div>
            )}
            <div className="inline-add">
              <select value={pickEmployee} onChange={(e) => setPickEmployee(e.target.value)}>
                <option value="">اختر موظفاً…</option>
                {employees.filter((e) => !form.attendee_ids.includes(e.id)).map((e) => (
                  <option key={e.id} value={e.id}>{e.name}{connectedIds.has(e.id) ? '' : ' (بلا تقويم مرتبط)'}</option>
                ))}
              </select>
              <button type="button" className="btn sm" onClick={addAttendee} disabled={!pickEmployee}>إضافة</button>
            </div>
            <small className="hint">لربط تقويم Google لموظف: افتح صفحة الموظفون → تعديل الموظف.</small>
          </div>
        </div>
      </Modal>
    </>
  );
}

const CSS = `
.appt-head{margin-bottom:18px;align-items:flex-end}.appt-head h2{margin:0}.appt-head p{margin:5px 0 0;color:var(--muted);font-size:13px}
.row-actions{display:flex;gap:6px;justify-content:flex-end}.danger-text{color:var(--neg)!important}
.appt-attendees{display:flex;flex-wrap:wrap;gap:5px}.chip.sm{font-size:11px;padding:3px 9px}.chip.linked{background:var(--sage-bg);color:var(--green)}
.appt-allday{flex-direction:row!important;align-items:center;justify-content:space-between;gap:10px}
.appt-noattendee{margin:0 0 8px;color:var(--muted);font-size:12.5px}.appt-warn{color:var(--neg)}
.inline-add{display:flex;gap:8px;margin-top:8px}.inline-add select{flex:1}
.hint{display:block;color:var(--muted);font-size:11.5px;margin-top:8px}
`;
