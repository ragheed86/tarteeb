'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getWaConversations, getWaMessages, getWaConversationContext, setConversationTakeover, addConversationToCrm, sendManualReply } from '@/lib/data';
import { Loading, Empty, ErrorBar } from '@/components';
import { useLanguage } from '@/i18n/LanguageProvider';
import { toast } from '../toast';
import styles from './inbox.module.css';

// ترجمات محلية للصفحة (نبقيها هنا كي لا نضخّم مزوّد اللغة العام)
const L = {
  ar: {
    search: 'ابحث باسم العميل أو الجوال…',
    noConversations: 'لا توجد محادثات واتساب بعد',
    noConversationsSub: 'ستظهر المحادثات هنا فور وصول أول رسالة من العميل.',
    pickOne: 'اختر محادثة لعرضها',
    noMessages: 'لا توجد رسائل في هذه المحادثة',
    takeOver: 'استلام المحادثة',
    returnToAI: 'إعادة للأتمتة',
    composer: 'اكتب رسالة…',
    send: 'إرسال',
    sent: 'أُرسلت الرسالة',
    hint: 'إرسالك اليدوي يوقف الأتمتة ويحوّل المحادثة لك. الردود تصل العميل عبر واتساب مباشرة.',
    customer: 'العميل', context: 'السياق', profile: 'فتح ملف العميل',
    district: 'الحي', service: 'الخدمة', source: 'المصدر', status: 'الحالة',
    state: 'حالة الأتمتة', pipeline: 'مرحلة المسار', pricing: 'التسعير', booking: 'الحجز',
    none: '—', aiOn: 'الأتمتة تعمل', human: 'استلام بشري', lead: 'عميل محتمل', existing: 'عميل حالي',
    priceNone: 'لا يوجد طلب تسعير', bookNone: 'لا يوجد طلب حجز',
    crmSection: 'إدارة العميل', notInCrm: 'لم يُضف للـCRM بعد', inCrm: 'مضاف للـCRM',
    addLead: 'أضف كعميل محتمل', addActive: 'أضف كعميل حالي', addedToCrm: 'تمت الإضافة للـCRM',
  },
  en: {
    search: 'Search by name or phone…',
    noConversations: 'No WhatsApp conversations yet',
    noConversationsSub: 'Conversations appear here as soon as the first message arrives.',
    pickOne: 'Select a conversation',
    noMessages: 'No messages in this conversation',
    takeOver: 'Take over',
    returnToAI: 'Return to AI',
    composer: 'Type a message…',
    send: 'Send',
    sent: 'Message sent',
    hint: 'Sending manually pauses automation and assigns the chat to you. Replies reach the customer on WhatsApp.',
    customer: 'Customer', context: 'Context', profile: 'Open client profile',
    district: 'District', service: 'Service', source: 'Source', status: 'Status',
    state: 'Automation', pipeline: 'Pipeline', pricing: 'Pricing', booking: 'Booking',
    none: '—', aiOn: 'AI active', human: 'Human takeover', lead: 'Lead', existing: 'Existing',
    priceNone: 'No pricing request', bookNone: 'No booking request',
    crmSection: 'Client management', notInCrm: 'Not in CRM yet', inCrm: 'In CRM',
    addLead: 'Add as lead', addActive: 'Add as active client', addedToCrm: 'Added to CRM',
  },
};

const SERVICE = {
  kitchen: { ar: 'مطبخ', en: 'Kitchen' }, closet: { ar: 'غرفة ملابس', en: 'Closet' },
  bedroom: { ar: 'غرفة نوم', en: 'Bedroom' }, storage: { ar: 'مستودع منزلي', en: 'Storage' },
  office: { ar: 'مكتب', en: 'Office' }, laundry: { ar: 'غسيل', en: 'Laundry' }, other: { ar: 'أخرى', en: 'Other' },
};
const PIPELINE = {
  NEW: { ar: 'جديد', en: 'New' }, COLLECTING_INFO: { ar: 'جمع معلومات', en: 'Collecting' },
  READY_FOR_REVIEW: { ar: 'جاهز للمراجعة', en: 'Ready' }, NEEDS_PRICING: { ar: 'بانتظار تسعير', en: 'Needs pricing' },
  QUOTE_SENT: { ar: 'أُرسل السعر', en: 'Quote sent' }, BOOKING_PENDING: { ar: 'بانتظار حجز', en: 'Booking pending' },
  BOOKED: { ar: 'محجوز', en: 'Booked' }, COMPLETED: { ar: 'مكتمل', en: 'Completed' },
};
const MEDIA_ICON = { voice: '🎤', image: '🖼️', video: '🎬', document: '📄', location: '📍' };

function timeShort(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}
function dayShort(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }); } catch { return ''; }
}

export default function InboxPage() {
  const { language } = useLanguage();
  const t = L[language] || L.ar;
  const [conversations, setConversations] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    getWaConversations().then(setConversations).catch((e) => setErr(e.message || 'تعذّر التحميل'));
  }, []);

  useEffect(() => {
    if (!selectedId) { setMessages(null); setCtx(null); return; }
    setMessages(null); setCtx(null); setDraft('');
    getWaMessages(selectedId).then(setMessages).catch((e) => setErr(e.message || 'تعذّر التحميل'));
    getWaConversationContext(selectedId).then(setCtx).catch(() => setCtx({ pricing: null, booking: null }));
  }, [selectedId]);

  const selected = useMemo(
    () => (conversations || []).find((c) => c.id === selectedId) || null,
    [conversations, selectedId],
  );

  const filtered = useMemo(() => {
    const list = conversations || [];
    const term = q.trim().toLowerCase();
    if (!term) return list;
    return list.filter((c) => {
      const name = (c.client?.name || c.contact_name || '').toLowerCase();
      const phone = (c.client?.phone || c.phone || '').toLowerCase();
      return name.includes(term) || phone.includes(term);
    });
  }, [conversations, q]);

  async function toggleTakeover() {
    if (!selected) return;
    setBusy(true);
    try {
      const next = !selected.automation_paused;
      const updated = await setConversationTakeover(selected.id, next);
      setConversations((list) => (list || []).map((c) => (c.id === selected.id ? { ...c, automation_paused: updated.automation_paused, state: updated.state } : c)));
      toast(next ? (language === 'ar' ? 'تم استلام المحادثة — الأتمتة متوقفة' : 'Taken over — automation paused') : (language === 'ar' ? 'أُعيدت للأتمتة' : 'Returned to AI'));
    } catch (e) {
      toast(e.message || 'تعذّر التحديث', 'err');
    } finally { setBusy(false); }
  }

  async function sendReply() {
    if (!selected || !draft.trim() || sending) return;
    const text = draft.trim();
    setSending(true);
    try {
      const res = await sendManualReply(selected.id, text);
      if (res?.error) throw new Error(res.error);
      const now = new Date().toISOString();
      setMessages((list) => [...(list || []), { id: res.message_id, direction: 'out', body: text, message_type: 'text', status: 'pending_send', occurred_at: now }]);
      setConversations((list) => (list || []).map((c) => (c.id === selected.id ? { ...c, automation_paused: true, state: 'HUMAN_TAKEOVER', last_message_at: now } : c)));
      setDraft('');
    } catch (e) {
      toast(e.message || 'تعذّر الإرسال', 'err');
    } finally { setSending(false); }
  }

  async function addToCrm(status) {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await addConversationToCrm(selected.id, status);
      if (res?.error) throw new Error(res.error);
      setConversations((list) => (list || []).map((c) => (c.id === selected.id
        ? { ...c, client: { ...(c.client || {}), id: res.client_id, name: c.client?.name || c.contact_name || c.phone, in_crm: true, status } }
        : c)));
      toast(t.addedToCrm);
    } catch (e) {
      toast(e.message || 'تعذّر الإضافة', 'err');
    } finally { setBusy(false); }
  }

  function label(map, key) { return map[key] ? (map[key][language] || map[key].ar) : key; }
  function previewText(c) {
    const m = (c.messages || [])[0];
    if (!m) return '';
    if (m.message_type && m.message_type !== 'text') return `${MEDIA_ICON[m.message_type] || '📎'} ${m.message_type}`;
    return m.body || '';
  }

  if (err) return <ErrorBar message={err} />;
  if (conversations === null) return <Loading />;
  if (conversations.length === 0) return <Empty title={t.noConversations} desc={t.noConversationsSub} />;

  const client = selected?.client;
  const stateBadge = (c) => {
    if (c.automation_paused || c.state === 'HUMAN_TAKEOVER') return <span className={`${styles.badge} ${styles.bHuman}`}>{t.human}</span>;
    return <span className={`${styles.badge} ${styles.bAI}`}>{t.aiOn}</span>;
  };

  return (
    <div className={`${styles.wrap} ${selectedId ? styles.hasSelection : ''}`}>
      {/* عمود القائمة */}
      <div className={styles.list}>
        <div className={styles.listHead}>
          <input className={styles.search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} />
        </div>
        <div className={styles.listScroll}>
          {filtered.map((c) => (
            <button key={c.id} type="button" className={`${styles.item} ${c.id === selectedId ? styles.active : ''}`} onClick={() => setSelectedId(c.id)}>
              <span className={styles.avatar}>{(c.client?.name || c.contact_name || c.phone || '؟').trim().charAt(0)}</span>
              <span className={styles.itemMain}>
                <span className={styles.itemName}>{c.client?.name || c.contact_name || c.phone || c.wa_id}</span>
                <span className={styles.itemPreview}>{previewText(c)}</span>
              </span>
              <span className={styles.itemMeta}>
                <span className={styles.itemTime}>{dayShort(c.last_message_at)}</span>
                {(c.automation_paused || c.state === 'HUMAN_TAKEOVER') && <span className={`${styles.badge} ${styles.bHuman}`}>{t.human}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* عمود المحادثة */}
      <div className={styles.thread}>
        {!selected ? (
          <div className={styles.placeholder}>{t.pickOne}</div>
        ) : (
          <>
            <div className={styles.threadHead}>
              <button type="button" className={styles.back} onClick={() => setSelectedId(null)} aria-label="back">→</button>
              <div>
                <div className={styles.threadTitle}>{client?.name || selected.contact_name || selected.phone || selected.wa_id}</div>
                <div className={styles.threadSub} dir="ltr">{client?.phone || selected.phone || ''}</div>
              </div>
              <div className={styles.threadActions}>
                {stateBadge(selected)}
                <button type="button" className="btn sm ghost" onClick={toggleTakeover} disabled={busy}>
                  {selected.automation_paused ? t.returnToAI : t.takeOver}
                </button>
              </div>
            </div>

            <div className={styles.messages}>
              {messages === null ? <Loading /> : messages.length === 0 ? (
                <div className={styles.placeholder}>{t.noMessages}</div>
              ) : messages.map((m) => (
                <div key={m.id} className={`${styles.row} ${m.direction === 'out' ? styles.out : styles.in}`}>
                  <div className={styles.bubble}>
                    {m.message_type && m.message_type !== 'text' && (
                      <span className={styles.media}>{MEDIA_ICON[m.message_type] || '📎'} {m.message_type}</span>
                    )}
                    {m.body && <span>{m.body}</span>}
                    {m.transcript && <span className={styles.transcript}>“{m.transcript}”</span>}
                    <span className={styles.time}>{timeShort(m.occurred_at)}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.composer}>
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                placeholder={t.composer}
                disabled={sending}
              />
              <button type="button" className="btn sm" onClick={sendReply} disabled={sending || !draft.trim()}>{t.send}</button>
            </div>
            <div className={styles.hint}>{t.hint}</div>
          </>
        )}
      </div>

      {/* عمود السياق */}
      <div className={styles.context}>
        {!selected ? (
          <div className={styles.placeholder}>{t.context}</div>
        ) : (
          <>
            <div className={styles.ctxName}>{client?.name || selected.contact_name || selected.phone || selected.wa_id}</div>
            <div className={styles.ctxPhone}>{client?.phone || selected.phone || ''}</div>

            {(!client || client.in_crm === false) ? (
              <div className={styles.ctxSection}>
                <div className={styles.ctxLabel}>{t.crmSection}</div>
                <div style={{ marginBottom: 8 }}><span className={`${styles.badge} ${styles.bMuted}`}>{t.notInCrm}</span></div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn sm" onClick={() => addToCrm('lead')} disabled={busy}>{t.addLead}</button>
                  <button type="button" className="btn sm ghost" onClick={() => addToCrm('active')} disabled={busy}>{t.addActive}</button>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className={`${styles.badge} ${styles.bAI}`}>{t.inCrm}</span>
                {client?.status === 'lead'
                  ? <span className={`${styles.badge} ${styles.bLead}`}>{t.lead}</span>
                  : <span className={`${styles.badge} ${styles.bMuted}`}>{t.existing}</span>}
              </div>
            )}

            <div className={styles.ctxSection}>
              <div className={styles.ctxLabel}>{t.customer}</div>
              <div className={styles.ctxRow}><span>{t.district}</span><span>{client?.district || t.none}</span></div>
              <div className={styles.ctxRow}><span>{t.service}</span><span>{client?.service_type ? label(SERVICE, client.service_type) : t.none}</span></div>
              <div className={styles.ctxRow}><span>{t.source}</span><span>{client?.source || t.none}</span></div>
              {client?.id && client.in_crm !== false && <Link href={`/clients/${client.id}`} className={styles.ctxLink}>{t.profile} ←</Link>}
            </div>

            <div className={styles.ctxSection}>
              <div className={styles.ctxLabel}>{t.state}</div>
              <div className={styles.ctxRow}><span>{t.state}</span><span>{selected.automation_paused ? t.human : t.aiOn}</span></div>
              <div className={styles.ctxRow}><span>{t.pipeline}</span><span>{label(PIPELINE, selected.pipeline_stage)}</span></div>
            </div>

            <div className={styles.ctxSection}>
              <div className={styles.ctxLabel}>{t.pricing}</div>
              <div className={styles.ctxRow}>
                <span>{t.pricing}</span>
                <span>{ctx?.pricing ? `${ctx.pricing.status}${ctx.pricing.approved_price ? ` · ${ctx.pricing.approved_price} ${ctx.pricing.currency || 'SAR'}` : ''}` : t.priceNone}</span>
              </div>
              <div className={styles.ctxRow}>
                <span>{t.booking}</span>
                <span>{ctx?.booking ? `${ctx.booking.status}${ctx.booking.requested_date ? ` · ${ctx.booking.requested_date}` : ''}` : t.bookNone}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
