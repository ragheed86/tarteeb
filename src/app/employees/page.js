'use client';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  getEmployees, createEmployee, updateEmployee, removeEmployee,
  getEmployeeDocuments, createEmployeeDocument, removeEmployeeDocument,
  uploadEmployeePhoto, getEmployeeCosts,
} from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { fmtNum, fmtDate, fmtMoney, CURRENCY } from '@/lib/format';
import { COUNTRIES_SORTED, countryByCode } from '@/lib/countries';
import { useAccess } from '@/lib/useAccess';
import { canAccess } from '@/lib/permissions';
import { Loading, Empty, ErrorBar } from '../ui';
import { toast } from '../toast';
import PayrollModal from './PayrollModal';

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${data.session?.access_token || ''}`, 'Content-Type': 'application/json' };
}

const WAGE = { fixed: 'ثابت', daily: 'يومي', hourly: 'بالساعة' };
const STATUS = { active: { label: 'نشط', cls: 'p-prog' }, on_project: { label: 'في مشروع', cls: 'p-quote' }, inactive: { label: 'غير نشط', cls: 'p-wait' } };
const DOC_TYPE = { national_id: 'هوية وطنية', iqama: 'إقامة', contract: 'عقد', health_cert: 'شهادة صحية', driving_license: 'رخصة قيادة', other: 'أخرى' };

const ROLE_GROUPS = [
  { group: 'الإدارة', items: [['المدير العام', 'General Manager'], ['مدير العمليات', 'Operations Manager'], ['مسؤول المبيعات', 'Sales Officer']] },
  { group: 'التشغيل', items: [['مشرف مشروع', 'Project Supervisor'], ['منظم مساحات', 'Space Organizer'], ['عامل مساعد', 'Assistant Worker'], ['مسؤول مشتريات', 'Purchasing Officer'], ['مسؤول مخزون', 'Inventory Officer'], ['محاسب', 'Accountant']] },
  { group: 'التسويق والإسناد', items: [['مسؤول تسويق', 'Marketing Officer'], ['صانع محتوى', 'Content Creator'], ['مصور', 'Photographer'], ['سائق', 'Driver'], ['مشرف جودة', 'Quality Supervisor']] },
];
const KNOWN_ROLES = ROLE_GROUPS.flatMap((g) => g.items.map(([ar]) => ar));
// ترتيب الأقدمية: القيادة أولاً ثم الإشراف ثم بقية الأدوار المعروفة ثم غير المعروفة.
// يعتمد على كلمات مفتاحية حتى يشمل الأدوار المكتوبة يدوياً (مثل CEO أو سوبر فايزر) لا القائمة فقط.
const ROLE_RANK = Object.fromEntries(KNOWN_ROLES.map((r, i) => [r, i]));
const LEAD_KW = ['مدير', 'رئيس', 'مؤسس', 'مالك', 'صاحب', 'ceo', 'coo', 'cfo', 'director', 'owner', 'founder', 'general manager'];
const SUP_KW = ['مشرف', 'سوبر', 'قائد', 'supervisor', 'lead', 'عمليات', 'operations'];
function roleRank(role) {
  if (!role) return 900;
  const r = role.toLowerCase();
  if (LEAD_KW.some((k) => r.includes(k))) return 0;
  if (SUP_KW.some((k) => r.includes(k))) return 100;
  if (role in ROLE_RANK) return 200 + ROLE_RANK[role];
  return 800;
}

const EMPTY = {
  name: '', name_ar: '', role: '', phone: '', national_id: '', nationality: '', wage: 'fixed', status: 'active',
  photo_url: '', photo_path: '', hire_date: '', iban: '', gosi_number: '', is_billable: true,
};

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

function profileCompletion(employee) {
  const fields = [
    employee.name, employee.name_ar, employee.role, employee.phone, employee.national_id,
    employee.nationality, employee.photo_url || employee.photo_path, employee.wage,
    employee.hire_date, employee.iban,
  ];
  return Math.round((fields.filter(Boolean).length / fields.length) * 100);
}

export default function EmployeesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <EmployeesPageInner />
    </Suspense>
  );
}

function EmployeesPageInner() {
  const [emps, setEmps] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [photoPreview, setPhotoPreview] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [docFor, setDocFor] = useState(null); // الموظف الذي تُعرض مستنداته
  const [calFor, setCalFor] = useState(null); // الموظف الذي يُدار ربط تقويمه
  const [payFor, setPayFor] = useState(null); // الموظف الذي يُفتح ملفه المالي
  const [costs, setCosts] = useState({}); // التكلفة الفعلية لكل موظف، مفهرسة بالمعرّف
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { access } = useAccess();
  const canSeePayroll = canAccess(access, 'payroll');

  useEffect(() => {
    const calendar = searchParams.get('calendar');
    if (!calendar) return;
    const msg = { connected: 'تم ربط تقويم Google بنجاح', cancelled: 'تم إلغاء ربط تقويم Google' }[calendar] || 'تعذّر ربط تقويم Google — ابدأ الربط من جديد من نفس المتصفح';
    toast(msg, calendar === 'connected' ? 'ok' : 'err');
    router.replace('/employees');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const visibleEmployees = useMemo(() => {
    const term = query.trim().toLowerCase();
    return [...(emps || [])]
      .filter((employee) => statusFilter === 'all' || employee.status === statusFilter)
      .filter((employee) => {
        if (!term) return true;
        const country = countryByCode(employee.nationality);
        return [employee.name, employee.name_ar, employee.role, employee.phone, employee.national_id, country?.ar, country?.en]
          .some((value) => String(value || '').toLowerCase().includes(term));
      })
      .sort((a, b) => roleRank(a.role) - roleRank(b.role));
  }, [emps, query, statusFilter]);

  // إجمالي ما يكلّفه الفريق على الشركة شهرياً، لا مجموع الرواتب.
  const teamCost = useMemo(
    () => Object.values(costs).reduce((sum, row) => sum + Number(row.total_employer_cost || 0), 0),
    [costs],
  );

  async function load() {
    try { setEmps(await getEmployees()); } catch (e) { setErr(e.message || 'تعذّر التحميل'); }
  }
  useEffect(() => { load(); }, []);

  // التكلفة تُقرأ فقط لمن يملك صلاحية الرواتب، وسياسات الوصول تمنع غيره
  // من الجهة الأخرى أيضاً.
  async function loadCosts() {
    if (!canSeePayroll) { setCosts({}); return; }
    try {
      const rows = await getEmployeeCosts();
      setCosts(Object.fromEntries(rows.map((row) => [row.employee_id, row])));
    } catch { setCosts({}); }
  }
  useEffect(() => { loadCosts(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [canSeePayroll]);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function openAdd() { setEditing(null); setForm(EMPTY); setPhotoPreview(''); setFormErr(''); setOpen(true); }
  function openEdit(em) {
    setEditing(em);
    setForm({
      name: em.name || '', name_ar: em.name_ar || '', role: em.role || '', phone: em.phone || '', national_id: em.national_id || '',
      nationality: em.nationality || '',
      wage: em.wage || 'fixed', status: em.status || 'active', photo_url: em.photo_url || '', photo_path: em.photo_path || '',
      hire_date: em.hire_date || '', iban: em.iban || '', gosi_number: em.gosi_number || '',
      is_billable: em.is_billable !== false,
    });
    setPhotoPreview('');
    setFormErr(''); setOpen(true);
  }
  function close() { if (!saving && !uploadingPhoto) { setOpen(false); setEditing(null); setPhotoPreview(''); } }

  async function handlePhotoFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoPreview(URL.createObjectURL(file));
    setUploadingPhoto(true); setFormErr('');
    try {
      const uploaded = await uploadEmployeePhoto(file);
      setForm((f) => ({ ...f, photo_url: uploaded.url, photo_path: uploaded.path }));
    } catch (e2) {
      setFormErr(e2.message || 'تعذّر رفع الصورة');
      setPhotoPreview('');
    } finally {
      setUploadingPhoto(false);
      e.target.value = '';
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setFormErr('اسم الموظف مطلوب'); return; }
    setSaving(true); setFormErr('');
    const payload = {
      name: form.name.trim(), name_ar: form.name_ar.trim() || null, role: form.role.trim() || null, phone: form.phone.trim() || null,
      national_id: form.national_id.trim() || null,
      nationality: form.nationality || null,
      wage: form.wage, status: form.status,
      photo_url: form.photo_path ? null : form.photo_url.trim() || null,
      photo_path: form.photo_path || null,
      hire_date: form.hire_date || null,
      iban: form.iban.trim().replace(/\s+/g, '').toUpperCase() || null,
      gosi_number: form.gosi_number.trim() || null,
      is_billable: form.is_billable,
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
        <span className="more" style={{ marginInlineStart: 'auto' }}>
          {fmtNum(emps.length)} موظف
          {canSeePayroll && teamCost > 0 && ` · كلفة الفريق ${fmtMoney(teamCost)} ${CURRENCY} شهرياً`}
        </span>
      </div>

      {emps.length === 0 ? (
        <div className="card"><Empty title="لا موظفين" desc="أضف أعضاء الفريق ومستنداتهم." /></div>
      ) : (
        <div className="employee-list-card">
          <div className="employee-toolbar">
            <label className="employee-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالاسم أو الدور أو الجوال" aria-label="البحث في الموظفين" />
            </label>
            <select className="employee-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="تصفية الموظفين حسب الحالة">
              <option value="all">كل الحالات</option>
              {Object.entries(STATUS).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
            </select>
            <span className="employee-result-count">{fmtNum(visibleEmployees.length)} نتيجة</span>
          </div>

          {visibleEmployees.length === 0 ? (
            <Empty title="لا توجد نتائج" desc="غيّر عبارة البحث أو مرشح الحالة." />
          ) : (
            <div className="employee-table-wrap">
              <table className="employee-table">
                <thead>
                  <tr>
                    <th>الموظف</th><th>الدور والجنسية</th><th>الحالة</th><th>نوع الأجر</th>
                    <th>اكتمال البيانات</th><th aria-label="الإجراءات" />
                  </tr>
                </thead>
                <tbody>
                  {visibleEmployees.map((em) => {
                    const st = STATUS[em.status] || { label: em.status, cls: 'p-wait' };
                    const country = countryByCode(em.nationality);
                    const completion = profileCompletion(em);
                    return (
                      <tr key={em.id}>
                        <td data-label="">
                          <div className="employee-person">
                            <div className="employee-list-photo">
                              {em.photo_url ? <img src={em.photo_url} alt="" /> : <span>{em.name?.trim()?.[0] || '؟'}</span>}
                            </div>
                            <div className="employee-person-copy">
                              <strong>{em.name_ar || em.name}</strong>
                              {em.name_ar && <span dir="ltr">{em.name}</span>}
                              <span dir={em.phone ? 'ltr' : undefined}>{em.phone || em.national_id || 'لا توجد بيانات اتصال'}</span>
                            </div>
                          </div>
                        </td>
                        <td data-label="الدور والجنسية">
                          <div className="employee-role-cell"><strong>{em.role || 'بدون دور'}</strong><span>{country ? `${country.flag} ${country.ar}` : 'الجنسية غير محددة'}</span></div>
                        </td>
                        <td data-label="الحالة"><span className={`pill ${st.cls}`}>{st.label}</span></td>
                        <td data-label="نوع الأجر"><span>{WAGE[em.wage] || em.wage || '—'}</span></td>
                        <td data-label="اكتمال البيانات">
                          <div className="employee-completion" aria-label={`اكتمال البيانات ${completion}%`}>
                            <div className="employee-progress"><i style={{ width: `${completion}%` }} /></div>
                            <b>{fmtNum(completion)}%</b>
                          </div>
                        </td>
                        <td data-label="">
                          <div className="employee-row-actions">
                            {canSeePayroll && (
                              <button className="icon-btn" onClick={() => setPayFor(em)} aria-label={`الملف المالي — ${em.name}`} title="الملف المالي">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20M7 15h3" /></svg>
                              </button>
                            )}
                            <button className="icon-btn" onClick={() => setDocFor(em)} aria-label={`المستندات — ${em.name}`} title="المستندات">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
                            </button>
                            <button className="icon-btn" onClick={() => setCalFor(em)} aria-label={`تقويم Google — ${em.name}`} title="تقويم Google">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" /></svg>
                            </button>
                            <button className="icon-btn" onClick={() => openEdit(em)} aria-label={`تعديل — ${em.name}`} title="تعديل">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                            </button>
                            <button className="icon-btn danger" onClick={() => del(em)} aria-label={`حذف — ${em.name}`} title="حذف">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" /><path d="M10 11v6M14 11v6" /></svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
              <div className="field span-2"><label>الاسم بالعربي</label><input value={form.name_ar} onChange={(e) => set('name_ar', e.target.value)} /></div>
              <div className="field"><label>الدور</label>
                <select value={form.role} onChange={(e) => set('role', e.target.value)}>
                  <option value="">— اختر الدور —</option>
                  {form.role && !KNOWN_ROLES.includes(form.role) && <option value={form.role}>{form.role}</option>}
                  {ROLE_GROUPS.map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.items.map(([ar, en]) => <option key={ar} value={ar}>{ar} | {en}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="field"><label>الجنسية</label>
                <NationalityPicker value={form.nationality} onChange={(code) => set('nationality', code)} />
              </div>
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
              <div className="field"><label>تاريخ المباشرة</label>
                <input type="date" lang="en-GB" dir="ltr" value={form.hire_date} onChange={(e) => set('hire_date', e.target.value)} />
              </div>
              <div className="field"><label>الآيبان</label>
                <input value={form.iban} onChange={(e) => set('iban', e.target.value)} dir="ltr" placeholder="SA00 0000 0000 0000 0000 0000" />
              </div>
              <div className="field"><label>رقم المشترك في التأمينات</label>
                <input value={form.gosi_number} onChange={(e) => set('gosi_number', e.target.value)} dir="ltr" inputMode="numeric" />
              </div>
              <div className="field">
                <label>تحميل التكلفة</label>
                <select value={form.is_billable ? 'yes' : 'no'} onChange={(e) => set('is_billable', e.target.value === 'yes')}>
                  <option value="yes">تُوزَّع على المشاريع</option>
                  <option value="no">إدارة عامة — تُنزَّل يدوياً</option>
                </select>
              </div>
              <div className="field span-2">
                <label>صورة الموظف</label>
                <div className="upload-row">
                  <label className="btn ghost sm" htmlFor="employee-photo">{uploadingPhoto ? 'جارٍ الرفع…' : 'رفع صورة الموظف'}</label>
                  <input id="employee-photo" type="file" accept="image/*" hidden disabled={uploadingPhoto} onChange={handlePhotoFile} />
                  <input
                    value={form.photo_url} onChange={(e) => setForm((f) => ({ ...f, photo_url: e.target.value, photo_path: '' }))} dir="ltr"
                    placeholder="أو الصق رابط الصورة المستضافة" style={{ flex: 1, minWidth: 200 }}
                  />
                </div>
                {(photoPreview || form.photo_url) && (
                  <img className="upload-preview" src={photoPreview || form.photo_url} alt="صورة الموظف" style={{ maxWidth: 140, borderRadius: '50%', aspectRatio: '1/1', objectFit: 'cover', opacity: uploadingPhoto ? 0.5 : 1 }} />
                )}
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" type="button" onClick={close} disabled={saving || uploadingPhoto}>إلغاء</button>
              <button className="btn" type="submit" disabled={saving || uploadingPhoto}>{saving ? 'جارٍ الحفظ…' : 'حفظ الموظف'}</button>
            </div>
          </form>
        </div>
      )}

      {docFor && <DocsModal employee={docFor} onClose={() => setDocFor(null)} />}
      {calFor && <CalendarModal employee={calFor} onClose={() => setCalFor(null)} />}
      {payFor && (
        <PayrollModal
          employee={payFor}
          cost={costs[payFor.id]}
          onClose={() => setPayFor(null)}
          onChanged={loadCosts}
        />
      )}
    </>
  );
}

function CalendarModal({ employee, onClose }) {
  const [status, setStatus] = useState(undefined); // undefined=يحمّل، null=غير مرتبط، كائن=متصل
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    try {
      const res = await fetch('/api/google-calendar/status', { headers: await authHeaders() });
      const p = await res.json();
      if (!res.ok) throw new Error(p.error);
      setStatus((p.connections || []).find((c) => c.employee_id === employee.id) || null);
    } catch (e) { setErr(e.message || 'تعذّر جلب حالة التقويم'); setStatus(null); }
  }
  useEffect(() => { load(); }, [employee.id]);

  async function connect() {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/google-calendar/connect', {
        method: 'POST', headers: await authHeaders(), body: JSON.stringify({ employee_id: employee.id }),
      });
      const p = await res.json();
      if (!res.ok) throw new Error(p.error);
      window.location.href = p.url;
    } catch (e) { setErr(e.message || 'تعذّر بدء الربط'); setBusy(false); }
  }
  async function disconnect() {
    if (!confirm('فصل تقويم Google عن هذا الموظف؟ لن تُزامَن مواعيده الجديدة بعد الآن.')) return;
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/google-calendar/disconnect', {
        method: 'POST', headers: await authHeaders(), body: JSON.stringify({ employee_id: employee.id }),
      });
      const p = await res.json();
      if (!res.ok) throw new Error(p.error);
      setStatus(null); toast(p.revoked === false ? 'تم إيقاف المزامنة — سيُكمل إلغاء الصلاحية لدى Google تلقائياً' : 'تم فصل التقويم وإلغاء الصلاحية لدى Google');
    } catch (e) { setErr(e.message || 'تعذّر الفصل'); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card">
        <div className="modal-head">
          <div><h2>تقويم Google — {employee.name}</h2><p>مزامنة أحادية الاتجاه: مواعيد ترتيب تظهر في تقويم هذا الموظف تلقائياً</p></div>
          <button className="icon-close" type="button" onClick={onClose} aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        {err && <div className="errbar">{err}</div>}
        {status === undefined ? <Loading /> : status ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span style={{ color: 'var(--muted)' }}>مرتبط بحساب</span><b dir="ltr">{status.google_email || '—'}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span style={{ color: 'var(--muted)' }}>تاريخ الربط</span><b>{fmtDate(status.created_at)}</b></div>
          </div>
        ) : (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>غير مرتبط بتقويم Google بعد.</p>
        )}
        <div className="modal-actions">
          <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>إغلاق</button>
          {status ? (
            <button className="btn ghost" style={{ color: 'var(--neg)' }} type="button" onClick={disconnect} disabled={busy}>فصل التقويم</button>
          ) : (
            <button className="btn" type="button" onClick={connect} disabled={busy || status === undefined}>{busy ? 'جارٍ التحويل…' : 'ربط تقويم Google'}</button>
          )}
        </div>
      </div>
    </div>
  );
}

function NationalityPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  const selected = countryByCode(value);

  const list = useMemo(() => {
    const term = q.trim();
    if (!term) return COUNTRIES_SORTED;
    const low = term.toLowerCase();
    return COUNTRIES_SORTED.filter((c) => c.ar.includes(term) || c.en.toLowerCase().includes(low));
  }, [q]);

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function pick(code) { onChange(code); setOpen(false); setQ(''); }

  return (
    <div className="combobox" ref={ref}>
      <button type="button" className="combobox-trigger" onClick={() => setOpen((o) => !o)}>
        {selected ? <span>{selected.flag} {selected.ar}</span> : <span className="ph">— اختر الجنسية —</span>}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="combobox-pop">
          <input className="combobox-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث عن جنسية" />
          <div className="combobox-list">
            {value && <button type="button" className="combobox-opt" onClick={() => pick('')}>— بدون —</button>}
            {list.length === 0 ? (
              <div className="combobox-empty">لا نتائج</div>
            ) : list.map((c) => (
              <button key={c.code} type="button" className={`combobox-opt${c.code === value ? ' sel' : ''}`} onClick={() => pick(c.code)}>
                <span className="cflag">{c.flag}</span>
                <span className="cnm">{c.ar}</span>
                <span className="cen" dir="ltr">{c.en}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
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
          <input type="date" lang="en-GB" value={form.expiry_date} onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))} dir="ltr" style={{ maxWidth: 160 }} />
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
