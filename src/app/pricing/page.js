'use client';
import { useEffect, useMemo, useState } from 'react';
import { getPricingRequests, getWaMessages, approvePricing } from '@/lib/data';
import { Loading, Empty, ErrorBar } from '@/components';
import { useLanguage } from '@/i18n/LanguageProvider';
import { toast } from '../toast';
import styles from './pricing.module.css';

const L = {
  ar: {
    queue: 'طلبات بانتظار التسعير', empty: 'لا توجد طلبات تسعير حالياً',
    emptySub: 'ستظهر هنا الطلبات الجاهزة للتسعير بعد اكتمال معلومات العميل ووسائطه.',
    pick: 'اختر طلباً لمراجعته وتسعيره', service: 'الخدمة', district: 'الحي', media: 'الوسائط',
    customer: 'العميل', type: 'النوع', conversation: 'المحادثة', price: 'السعر (ريال)',
    notes: 'ملاحظات (اختياري)', approve: 'اعتماد وإرسال', approving: 'جاري الاعتماد…',
    lead: 'عميل محتمل', existing: 'عميل حالي', enterPrice: 'أدخل السعر أولاً',
    preview: 'سيُرسل للعميل بعد الاعتماد رد يتضمّن هذا السعر.', done: 'تم اعتماد السعر وتجهيز الرد ✅',
    guard: 'لا يمكن لأي رد آلي أن يتضمّن سعراً إلا بعد اعتمادك هنا.',
  },
  en: {
    queue: 'Pending pricing', empty: 'No pricing requests',
    emptySub: 'Requests ready for pricing appear here once customer info and media are complete.',
    pick: 'Select a request to review and price', service: 'Service', district: 'District', media: 'Media',
    customer: 'Customer', type: 'Type', conversation: 'Conversation', price: 'Price (SAR)',
    notes: 'Notes (optional)', approve: 'Approve & Send', approving: 'Approving…',
    lead: 'Lead', existing: 'Existing', enterPrice: 'Enter a price first',
    preview: 'On approval, a reply including this price will be queued to the customer.', done: 'Price approved and reply queued ✅',
    guard: 'No automated reply may contain a price until you approve it here.',
  },
};
const SERVICE = { kitchen: { ar: 'مطبخ', en: 'Kitchen' }, closet: { ar: 'غرفة ملابس', en: 'Closet' }, bedroom: { ar: 'غرفة نوم', en: 'Bedroom' }, storage: { ar: 'مستودع منزلي', en: 'Storage' }, office: { ar: 'مكتب', en: 'Office' }, laundry: { ar: 'غسيل', en: 'Laundry' }, other: { ar: 'أخرى', en: 'Other' } };
const MEDIA_ICON = { voice: '🎤', image: '🖼️', video: '🎬', document: '📄', location: '📍' };

export default function PricingPage() {
  const { language } = useLanguage();
  const t = L[language] || L.ar;
  const [requests, setRequests] = useState(null);
  const [err, setErr] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState(null);
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { getPricingRequests().then(setRequests).catch((e) => setErr(e.message || 'تعذّر التحميل')); }, []);

  const selected = useMemo(() => (requests || []).find((r) => r.id === selectedId) || null, [requests, selectedId]);

  useEffect(() => {
    if (!selected) { setMessages(null); return; }
    setMessages(null); setPrice(''); setNotes('');
    getWaMessages(selected.conversation_id).then(setMessages).catch(() => setMessages([]));
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  function label(map, key) { return map[key] ? (map[key][language] || map[key].ar) : (key || '—'); }

  async function doApprove() {
    const p = Number(price);
    if (!selected || !p || p <= 0) { toast(t.enterPrice, 'err'); return; }
    setBusy(true);
    try {
      const res = await approvePricing(selected.id, p, notes);
      if (res && res.error) throw new Error(res.error);
      toast(t.done);
      setRequests((list) => (list || []).filter((r) => r.id !== selected.id));
      setSelectedId(null);
    } catch (e) {
      toast(e.message || 'تعذّر الاعتماد', 'err');
    } finally { setBusy(false); }
  }

  if (err) return <ErrorBar message={err} />;
  if (requests === null) return <Loading />;
  if (requests.length === 0) return <Empty title={t.empty} desc={t.emptySub} />;

  const c = selected?.client;
  return (
    <div className={styles.wrap}>
      <div className={styles.list}>
        <div className={styles.listHead}><span>{t.queue}</span><span className={styles.count}>{requests.length}</span></div>
        <div className={styles.listScroll}>
          {requests.map((r) => (
            <button key={r.id} type="button" className={`${styles.item} ${r.id === selectedId ? styles.active : ''}`} onClick={() => setSelectedId(r.id)}>
              <div className={styles.itemName}>{r.client?.name || '—'}</div>
              <div className={styles.itemMeta}>{label(SERVICE, r.service_type)} · {r.district || '—'} · {r.media_summary || ''}</div>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.detail}>
        {!selected ? <div className={styles.placeholder}>{t.pick}</div> : (
          <>
            <div className={styles.dName}>{c?.name || '—'}</div>
            <div className={styles.dPhone}>{c?.phone || ''}</div>
            <div style={{ marginTop: 6 }}>{c?.status === 'lead'
              ? <span className={styles.count}>{t.lead}</span>
              : <span className={styles.count} style={{ background: 'var(--sage-bg)', color: 'var(--green)' }}>{t.existing}</span>}</div>

            <div className={styles.grid}>
              <div className={styles.cell}><div className={styles.cellLabel}>{t.service}</div><div className={styles.cellValue}>{label(SERVICE, selected.service_type)}</div></div>
              <div className={styles.cell}><div className={styles.cellLabel}>{t.district}</div><div className={styles.cellValue}>{selected.district || '—'}</div></div>
              <div className={styles.cell}><div className={styles.cellLabel}>{t.media}</div><div className={styles.cellValue}>{selected.media_summary || '—'}</div></div>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionTitle}>{t.conversation}</div>
              <div className={styles.msgs}>
                {messages === null ? <Loading /> : messages.length === 0 ? <span className={styles.msgTag}>—</span> : messages.map((m) => (
                  <div key={m.id} className={`${styles.msg} ${m.direction === 'out' ? styles.msgOut : styles.msgIn}`}>
                    <span className={styles.msgTag}>{m.direction === 'out' ? '↩︎ ' : ''}{m.message_type !== 'text' ? (MEDIA_ICON[m.message_type] || '📎') + ' ' : ''}</span>
                    {m.body || (m.transcript ? `“${m.transcript}”` : (m.message_type !== 'text' ? m.message_type : ''))}
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.approve}>
              <div className={styles.priceRow}>
                <div className={styles.fieldGroup}>
                  <label>{t.price}</label>
                  <input className={styles.priceInput} type="number" inputMode="numeric" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" dir="ltr" />
                </div>
                <button type="button" className="btn" onClick={doApprove} disabled={busy}>{busy ? t.approving : t.approve}</button>
              </div>
              <input className={styles.notesInput} type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t.notes} />
              {Number(price) > 0 && <div className={styles.preview}>{`سعر خدمة ترتيب ${label(SERVICE, selected.service_type)} هو ${Number(price)} ريال 🌟`}</div>}
              <div className={styles.guardNote}>🔒 {t.guard}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
