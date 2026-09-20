'use client';
import { useEffect, useMemo, useState } from 'react';
import { getBookingRequests, getWaMessages, decideBooking } from '@/lib/data';
import { Loading, Empty, ErrorBar } from '@/components';
import { useLanguage } from '@/i18n/LanguageProvider';
import { toast } from '../toast';
import styles from './bookings.module.css';

const L = {
  ar: {
    queue: 'حجوزات بانتظار الموافقة', empty: 'لا توجد طلبات حجز حالياً',
    emptySub: 'ستظهر هنا طلبات المواعيد عند طلب العملاء الحجز.',
    pick: 'اختر طلب حجز لمراجعته', requested: 'الموعد المطلوب', conversation: 'المحادثة',
    confirm: 'تأكيد الموعد', reject: 'رفض', reschedule: 'اقتراح وقت آخر', notes: 'ملاحظة (اختياري)',
    working: 'جاري…', pickTime: 'اختر الوقت البديل أولاً', reschedLabel: 'وقت بديل',
    cal: 'إنشاء حدث Google Calendar تلقائياً يتفعّل بعد ربط اعتماد التقويم في n8n. حالياً التأكيد يُرسل تأكيداً للعميل ويحدّث الحالة.',
    resched: 'اقتُرح وقت بديل', noTime: 'بدون وقت محدّد',
  },
  en: {
    queue: 'Pending bookings', empty: 'No booking requests',
    emptySub: 'Appointment requests appear here when customers ask to book.',
    pick: 'Select a booking to review', requested: 'Requested time', conversation: 'Conversation',
    confirm: 'Confirm', reject: 'Reject', reschedule: 'Suggest another time', notes: 'Note (optional)',
    working: 'Working…', pickTime: 'Pick an alternative time first', reschedLabel: 'Alternative time',
    cal: 'Automatic Google Calendar event creation activates after the calendar credential is connected in n8n. For now, confirming sends the customer a confirmation and updates status.',
    resched: 'Alternative suggested', noTime: 'No specific time',
  },
};
const MEDIA_ICON = { voice: '🎤', image: '🖼️', video: '🎬', document: '📄', location: '📍' };

export default function BookingsPage() {
  const { language } = useLanguage();
  const t = L[language] || L.ar;
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState(null);
  const [notes, setNotes] = useState('');
  const [suggested, setSuggested] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { getBookingRequests().then(setRows).catch((e) => setErr(e.message || 'تعذّر التحميل')); }, []);
  const selected = useMemo(() => (rows || []).find((r) => r.id === selectedId) || null, [rows, selectedId]);
  useEffect(() => {
    if (!selected) { setMessages(null); return; }
    setMessages(null); setNotes(''); setSuggested('');
    getWaMessages(selected.conversation_id).then(setMessages).catch(() => setMessages([]));
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  function whenText(r) {
    if (!r) return t.noTime;
    const d = r.requested_date || '';
    const tm = r.requested_time ? ` · ${r.requested_time}` : '';
    return d ? `${d}${tm}` : (r.requested_time || t.noTime);
  }

  async function decide(decision) {
    if (!selected) return;
    if (decision === 'reschedule' && !suggested) { toast(t.pickTime, 'err'); return; }
    setBusy(true);
    try {
      const opts = { notes };
      if (decision === 'reschedule') opts.suggested = new Date(suggested).toISOString();
      const res = await decideBooking(selected.id, decision, opts);
      if (res && res.error) throw new Error(res.error);
      toast(res?.reply || 'تم');
      setRows((list) => (list || []).filter((r) => r.id !== selected.id));
      setSelectedId(null);
    } catch (e) {
      toast(e.message || 'تعذّر تنفيذ القرار', 'err');
    } finally { setBusy(false); }
  }

  if (err) return <ErrorBar message={err} />;
  if (rows === null) return <Loading />;
  if (rows.length === 0) return <Empty title={t.empty} desc={t.emptySub} />;

  const c = selected?.client;
  return (
    <div className={styles.wrap}>
      <div className={styles.list}>
        <div className={styles.listHead}><span>{t.queue}</span><span className={styles.count}>{rows.length}</span></div>
        <div className={styles.listScroll}>
          {rows.map((r) => (
            <button key={r.id} type="button" className={`${styles.item} ${r.id === selectedId ? styles.active : ''}`} onClick={() => setSelectedId(r.id)}>
              <div className={styles.itemName}>{r.client?.name || '—'}</div>
              <div className={styles.itemMeta}>{whenText(r)}{r.status === 'RESCHEDULE_SUGGESTED' && <span className={styles.tagResched}> · {t.resched}</span>}</div>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.detail}>
        {!selected ? <div className={styles.placeholder}>{t.pick}</div> : (
          <>
            <div className={styles.dName}>{c?.name || '—'}</div>
            <div className={styles.dPhone}>{c?.phone || ''}</div>
            <div className={styles.when}>
              <div className={styles.whenLabel}>{t.requested}</div>
              <div className={styles.whenValue}>{whenText(selected)}</div>
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

            <div className={styles.actions}>
              <input className={styles.notesInput} type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t.notes} />
              <div className={styles.btnRow}>
                <button type="button" className="btn" onClick={() => decide('confirm')} disabled={busy}>{busy ? t.working : t.confirm}</button>
                <button type="button" className={`btn ghost ${styles.btnReject}`} onClick={() => decide('reject')} disabled={busy}>{t.reject}</button>
              </div>
              <div className={styles.reschedRow}>
                <label className={styles.msgTag}>{t.reschedLabel}:</label>
                <input className={styles.dt} type="datetime-local" value={suggested} onChange={(e) => setSuggested(e.target.value)} />
                <button type="button" className="btn ghost" onClick={() => decide('reschedule')} disabled={busy}>{t.reschedule}</button>
              </div>
              <div className={styles.calNote}>📅 {t.cal}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
