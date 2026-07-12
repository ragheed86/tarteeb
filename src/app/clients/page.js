'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient, updateClient, removeClient, getClients, getEmployees } from '@/lib/data';
import { fmtNum, CLIENT_STATUS, SOURCE_LABEL } from '@/lib/format';
import { Loading, Empty, ErrorBar, Modal, DataTable, Input, Select, TextArea, Ltr } from '@/components';
import { toast } from '../toast';

// القائمة الكاملة لأحياء الرياض (ويكيبيديا: https://ar.wikipedia.org/wiki/أحياء_الرياض)
const RIYADH_DISTRICTS = [
  'أحد', 'أشبيلية', 'الإزدهار', 'الإسكان', 'الأندلس', 'البديعة', 'البرية', 'البطيحا',
  'التعاون', 'الجرادية', 'الجزيرة', 'الجنادرية', 'الحاير', 'الحزم', 'الحمراء', 'الخالدية',
  'الخزامى', 'الخليج', 'الدار البيضاء', 'الدريهمية', 'الدفاع', 'الدوبية', 'الديرة', 'الربوة',
  'الربيع', 'الرفيعة', 'الرمال', 'الروابي', 'الروضة', 'الريان', 'الزهراء', 'الزهرة',
  'السعادة', 'السفارات', 'السلام', 'السلي', 'السليمانية', 'السويدي', 'السويدي الغربي', 'الشرقية',
  'الشفاء', 'الشميسي', 'الصحافة', 'الصفا', 'الصناعية', 'الصناعية الجديدة', 'الضباط', 'العارض',
  'العريجاء', 'العريجاء الغربية', 'العريجاء الوسطى', 'العزيزية', 'العقيق', 'العليا', 'العماجية', 'العمل',
  'العود', 'الغدير', 'الغنامية', 'الفاخرية', 'الفاروق', 'الفلاح', 'الفوطة', 'الفيحاء',
  'الفيصلية', 'القادسية', 'القدس', 'القرى', 'القيروان', 'المؤتمرات', 'المربع', 'المرسلات',
  'المرقب', 'المروة', 'المروج', 'المشاعل', 'المصانع', 'المصفاة', 'المصيف', 'المعذر',
  'المعيزلية', 'المغرزات', 'الملز', 'الملقا', 'الملك عبد العزيز', 'الملك عبد الله', 'الملك فهد', 'الملك فيصل',
  'المناخ', 'المنار', 'المنصورة', 'المنصورية', 'المهدية', 'المونسية', 'الناصرية', 'الندوة',
  'الندى', 'النرجس', 'النزهة', 'النسيم الشرقي', 'النسيم الغربي', 'النظيم', 'النفل', 'النموذجية',
  'النهضة', 'النور', 'الهدا', 'الوادي', 'الورود', 'الوزارات', 'الوسيطاء', 'الوشام',
  'الياسمين', 'اليرموك', 'اليمامة', 'أم سليم', 'بدر', 'بنبان', 'ثليم', 'جبرة',
  'جرير', 'حطين', 'خشم العان', 'ديراب', 'سلام', 'سلطانة', 'شبرا', 'صلاح الدين',
  'صياح', 'طيبة', 'ظهرة البديعة', 'ظهرة لبن', 'ظهرة نمار', 'عتيقة', 'عرقة', 'عريض',
  'عكاظ', 'عليشة', 'غبيراء', 'غرناطة', 'قرطبة', 'معكال', 'منفوحة', 'منفوحة الجديدة',
  'نمار', 'هيت', 'وادي لبن',
];

const SOURCE_OPTIONS = [
  { value: 'instagram', label: 'انستقرام' },
  { value: 'tiktok', label: 'تيك توك' },
  { value: 'client_referral', label: 'عن طريق عميل' },
  { value: 'employee_referral', label: 'عن طريق موظف' },
  { value: 'referral', label: 'توصية صديق' },
  { value: 'other', label: 'أخرى' },
];

const EMPTY_FORM = {
  name: '',
  phone: '',
  source: 'instagram',
  source_ref: '',
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
    source_ref: c.referred_by_client_id || c.referred_by_employee_id || '',
    district: c.district || '',
    status: c.status || 'active',
    first_contact_at: c.first_contact_at || '',
    notes: c.notes || '',
  };
}

export default function ClientsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ClientsPageInner />
    </Suspense>
  );
}

function ClientsPageInner() {
  const searchParams = useSearchParams();
  const [clients, setClients] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [err, setErr] = useState('');
  const [q, setQ] = useState(searchParams.get('district') || '');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = إضافة، كائن = تعديل
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [popped, setPopped] = useState(null); // آخر عميل تغيّرت حالته — لنبضة الـpill

  useEffect(() => {
    Promise.all([getClients(), getEmployees()])
      .then(([clientsData, employeesData]) => {
        setClients(clientsData);
        setEmployees(employeesData);
      })
      .catch((e) => setErr(e.message || 'تعذّر التحميل'));
  }, []);

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === 'source' ? { source_ref: '' } : null),
    }));
  }

  function buildPayload() {
    // الإحالة تُخزَّن بأعمدة حقيقية (referred_by_*) لا نصاً داخل الملاحظات
    const { source_ref, ...rest } = form;
    return {
      ...rest,
      referred_by_client_id: form.source === 'client_referral' ? source_ref || null : null,
      referred_by_employee_id: form.source === 'employee_referral' ? source_ref || null : null,
    };
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
      const payload = buildPayload();
      if (editing) {
        const updated = await updateClient(editing.id, payload);
        setClients((current) => (current || []).map((c) => (c.id === updated.id ? updated : c)));
      } else {
        const client = await createClient(payload);
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
    if (!confirm(`حذف العميل «${c.name}»؟ سيُحذف معه مشاريعه، وستبقى فواتيره السابقة بلا عميل مرتبط.`)) return;
    try {
      await removeClient(c.id);
      setClients((current) => (current || []).filter((x) => x.id !== c.id));
      toast(`حُذف العميل «${c.name}»`);
    } catch (error) {
      toast(error.message || 'تعذّر الحذف', 'err');
    }
  }

  async function changeStatus(c, status) {
    if (status === c.status) return;
    const prev = c.status;
    setPopped(c.id);
    setClients((current) => (current || []).map((x) => (x.id === c.id ? { ...x, status } : x)));
    try {
      await updateClient(c.id, { status });
    } catch (error) {
      setClients((current) => (current || []).map((x) => (x.id === c.id ? { ...x, status: prev } : x)));
      toast(error.message || 'تعذّر تحديث الحالة', 'err');
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
  const sourceClients = clients.filter((c) => c.id !== editing?.id);

  // مؤشرات على كامل قاعدة العملاء (لا تتأثر بالبحث)
  const total = clients.length;
  const byStatus = (s) => clients.filter((c) => (c.status || 'active') === s).length;
  const activeCount = byStatus('active');
  const leadCount = byStatus('lead');
  const waitingCount = byStatus('waiting');
  const completedCount = byStatus('completed');
  const now = new Date();
  const newThisMonth = clients.filter((c) => {
    if (!c.created_at) return false;
    const d = new Date(c.created_at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  const activePct = total ? Math.round((activeCount / total) * 100) : 0;

  return (
    <>
      {/* مؤشرات العملاء — مربعات صغيرة في صف واحد */}
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(6,minmax(0,1fr))' }}>
        <div className="kpi"><div className="lbl">إجمالي العملاء</div><div className="val">{fmtNum(total)}</div><div className="trend"><span>كامل القاعدة</span></div></div>
        <div className="kpi"><div className="lbl">عملاء نشطون</div><div className="val">{fmtNum(activeCount)}</div><div className="trend"><span>{fmtNum(activePct)}% منهم</span></div></div>
        <div className="kpi"><div className="lbl">محتملون</div><div className="val">{fmtNum(leadCount)}</div><div className="trend"><span>فرص للتحويل</span></div></div>
        <div className="kpi"><div className="lbl">بانتظار رد</div><div className="val">{fmtNum(waitingCount)}</div><div className="trend"><span>تحتاج متابعة</span></div></div>
        <div className="kpi"><div className="lbl">مكتملون</div><div className="val">{fmtNum(completedCount)}</div><div className="trend"><span>انتهى التعامل</span></div></div>
        <div className="kpi"><div className="lbl">جدد هذا الشهر</div><div className="val">{fmtNum(newThisMonth)}</div><div className="trend"><span>خلال الشهر</span></div></div>
      </div>
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
          <DataTable
            rows={filtered}
            pageSize={50}
            columns={[
              {
                key: 'name', label: 'العميل', primary: true,
                render: (c) => (
                  <>
                    <Link href={`/clients/${c.id}`} className="nm" style={{ color: 'var(--green)' }}>{c.name}</Link>
                    <br /><span className="uid">{c.code || '—'}</span>
                  </>
                ),
              },
              { key: 'phone', label: 'الجوال', align: 'center', render: (c) => <Ltr className="amt">{c.phone || '—'}</Ltr> },
              { key: 'source', label: 'المصدر', render: (c) => <span className="src">{SOURCE_LABEL[c.source] || c.source || '—'}</span> },
              { key: 'district', label: 'الحي', render: (c) => c.district || '—' },
              {
                key: 'status', label: 'الحالة',
                render: (c) => {
                  const st = CLIENT_STATUS[c.status] || { label: c.status || '—', cls: 'p-wait' };
                  return (
                    <select
                      key={c.status}
                      className={`status-select pill ${popped === c.id ? 'pop ' : ''}${st.cls}`}
                      value={c.status || 'active'}
                      onChange={(e) => changeStatus(c, e.target.value)}
                      aria-label={`حالة العميل ${c.name}`}
                    >
                      <option value="lead">عميل محتمل</option>
                      <option value="active">عميل نشط</option>
                      <option value="waiting">بانتظار رد</option>
                      <option value="completed">مكتمل</option>
                    </select>
                  );
                },
              },
              {
                key: 'actions', label: '', align: 'left',
                render: (c) => (
                  <>
                    <button className="btn ghost sm" onClick={() => openEdit(c)}>تعديل</button>
                    <button className="btn ghost sm" style={{ marginInlineStart: 8, color: 'var(--neg)' }} onClick={() => del(c)}>حذف</button>
                  </>
                ),
              },
            ]}
          />
        )}
      </div>

      <Modal
        open={formOpen}
        onClose={closeForm}
        className="client-form"
        title={editing ? 'تعديل عميل' : 'عميل جديد'}
        subtitle={editing ? 'تحديث بيانات العميل' : 'إضافة عميل إلى قاعدة عملاء ترتيب'}
        as="form"
        onSubmit={submit}
        footer={(
          <>
            <button className="btn ghost" type="button" onClick={closeForm} disabled={saving}>إلغاء</button>
            <button className="btn" type="submit" disabled={saving}>
              {saving ? 'جارٍ الحفظ…' : editing ? 'حفظ التعديل' : 'حفظ العميل'}
            </button>
          </>
        )}
      >
        {formErr && <div className="errbar">{formErr}</div>}

        <div className="form-grid">
          <Input label="اسم العميل" value={form.name} onChange={(e) => updateField('name', e.target.value)} required autoFocus />
          <Input label="رقم الجوال" ltr inputMode="tel" value={form.phone} onChange={(e) => updateField('phone', e.target.value)} />
          <Select label="المصدر" value={form.source} onChange={(e) => updateField('source', e.target.value)} options={SOURCE_OPTIONS} />
          {form.source === 'client_referral' && (
            <Select label="اسم العميل المحيل" value={form.source_ref} onChange={(e) => updateField('source_ref', e.target.value)}>
              <option value="">اختر عميلاً…</option>
              {sourceClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
          {form.source === 'employee_referral' && (
            <Select label="اسم الموظف" value={form.source_ref} onChange={(e) => updateField('source_ref', e.target.value)}>
              <option value="">اختر موظفاً…</option>
              {employees.map((em) => <option key={em.id} value={em.id}>{em.name}</option>)}
            </Select>
          )}
          <Select label="الحالة" value={form.status} onChange={(e) => updateField('status', e.target.value)}
            options={[
              { value: 'lead', label: 'عميل محتمل' },
              { value: 'active', label: 'عميل نشط' },
              { value: 'waiting', label: 'بانتظار رد' },
              { value: 'completed', label: 'مكتمل' },
            ]} />
          <Select label="الحي" value={form.district} onChange={(e) => updateField('district', e.target.value)}>
            <option value="">اختر حي الرياض…</option>
            {RIYADH_DISTRICTS.map((district) => (
              <option key={district} value={district}>{district}</option>
            ))}
          </Select>
          <Input label="تاريخ أول تواصل" ltr type="date" value={form.first_contact_at} onChange={(e) => updateField('first_contact_at', e.target.value)} />
          <TextArea className="span-2" label="ملاحظات" value={form.notes} onChange={(e) => updateField('notes', e.target.value)} rows={3} />
        </div>
      </Modal>
    </>
  );
}
