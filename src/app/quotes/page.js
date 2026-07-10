'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { fmtNum } from '@/lib/format';
import { getClients, createClient, getQuotes, getQuote, createQuote, updateQuote, removeQuote, nextQuoteNumber } from '@/lib/data';

const RIYAL = '⃁';
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const STATUS = {
  draft: ['qg-b-draft', 'مسودة'],
  sent: ['qg-b-sent', 'مُرسل'],
  negotiation: ['qg-b-nego', 'تفاوض'],
  accepted: ['qg-b-accepted', 'مقبول'],
  rejected: ['qg-b-rejected', 'مرفوض'],
  expired: ['qg-b-expired', 'منتهي الصلاحية'],
};
// أعمدة لوحة المتابعة بالترتيب المنطقي لدورة حياة العرض
const BOARD_COLUMNS = ['draft', 'sent', 'negotiation', 'accepted', 'rejected', 'expired'];
const REJECTION_REASONS = { price: 'السعر', timing: 'التوقيت', competitor: 'منافس', no_response: 'بلا رد', other: 'أخرى' };
const DAY = 86400000;
const FOLLOWUP_DAYS = 3; // عرض مُرسل بلا رد بعد هذه المدة يحتاج متابعة
const EXPIRY_WARN_DAYS = 2; // تنبيه قرب انتهاء الصلاحية

function blankItem() { return { svc: '', cost: 0, days: 1, discount: 0 }; }
function defaults() {
  return {
    id: null, number: '', status: 'draft', client: '', linked_client_id: null,
    date: new Date().toISOString().slice(0, 10),
    desc: 'تنظيم وترتيب غرفة مخزن الشركة بطريقة عملية واحترافية لتحسين الوصول إلى الأدوات والمواد، مع تعظيم الاستفادة من مساحة التخزين المتاحة.',
    items: [{ svc: 'تنظيم وترتيب غرفة مخزن الشركة لمدة يومين', cost: 500, days: 2, discount: 100 }],
    note: 'السعر لا يشمل الأدوات والمستلزمات التنظيمية، والتي سيتم شراؤها وفوترتها بشكل منفصل.',
    toolsShow: true, toolsMin: 400, toolsMax: 600,
    validity: 'هذا المقترح صالح لمدة أسبوع واحد من تاريخ الإرسال.',
    // حقول المتابعة
    validityDays: 7, sent_at: null, decided_at: null, rejection_reason: '',
    status_history: [{ status: 'draft', at: Date.now() }],
  };
}
const lineTotal = (it) => (Number(it.cost) || 0) * (Number(it.days) || 0) - (Number(it.discount) || 0);
const quoteAmount = (rec) => (rec.items || []).reduce((s, it) => s + lineTotal(it), 0);
// تاريخ انتهاء الصلاحية مُشتق من التاريخ + مدة الصلاحية (لا يُخزَّن، يُحسب دائماً)
function validUntil(rec) {
  const base = rec.date;
  if (!base) return null;
  return new Date(new Date(base + 'T00:00:00').getTime() + (Number(rec.validityDays) || 7) * DAY).toISOString().slice(0, 10);
}
// الحالة الفعلية: «مُرسل» تجاوز صلاحيته يُعدّ «منتهياً» تلقائياً دون تعديل المخزّن
function effectiveStatus(rec) {
  if (rec.status === 'sent') {
    const vu = validUntil(rec);
    if (vu && Date.parse(vu) < Date.now()) return 'expired';
  }
  return rec.status || 'draft';
}
// هل يحتاج العرض متابعة؟ (مُرسل/تفاوض متأخر الرد أو قارب على الانتهاء)
function needsFollowup(rec) {
  const es = effectiveStatus(rec);
  if (es !== 'sent' && es !== 'negotiation') return false;
  const daysSinceSent = rec.sent_at ? (Date.now() - rec.sent_at) / DAY : 0;
  const vu = validUntil(rec);
  const nearExpiry = vu && (Date.parse(vu) - Date.now()) / DAY <= EXPIRY_WARN_DAYS;
  return daysSinceSent >= FOLLOWUP_DAYS || nearExpiry;
}
function fmtQuoteDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, '0')} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function Money({ v }) {
  return <span dir="ltr"><span className="qg-riyal">{RIYAL}</span> {fmtNum(v)}</span>;
}

export default function QuotesPage() {
  const [q, setQ] = useState(defaults);
  const [list, setList] = useState([]);
  const [view, setView] = useState('editor'); // 'editor' | 'board'
  const [drawer, setDrawer] = useState(false);
  const [clientPrompt, setClientPrompt] = useState(false); // نافذة «إضافة العميل» عند القبول
  const [addingClient, setAddingClient] = useState(false);
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scale, setScale] = useState(1);
  const [contentScale, setContentScale] = useState(1);
  const paneRef = useRef(null);
  const pageRef = useRef(null);
  const innerRef = useRef(null);

  const refreshList = useCallback(async () => {
    try { setList(await getQuotes()); } catch (e) { /* تجاهل — يبقى آخر تحميل */ }
  }, []);
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [num, quotes] = await Promise.all([nextQuoteNumber(), getQuotes()]);
        setList(quotes);
        setQ({ ...defaults(), number: num });
      } catch (e) { setQ(defaults()); }
      setLoading(false);
    })();
  }, []);

  const fit = useCallback(() => {
    const pane = paneRef.current, page = pageRef.current, inner = innerRef.current;
    if (!pane || !page) return;
    const avail = pane.clientWidth - 48;
    setScale(Math.min(1, avail / page.offsetWidth));
    // تصغير المحتوى ليتّسع في صفحة A4 واحدة (297mm) عند تجاوزه
    if (inner) {
      const target = page.clientHeight; // ارتفاع A4 الثابت
      const natural = inner.scrollHeight; // ارتفاع المحتوى الفعلي (قبل التحويل)
      setContentScale(natural > target ? target / natural : 1);
    }
  }, []);
  useEffect(() => {
    fit();
    const ro = new ResizeObserver(fit);
    if (paneRef.current) ro.observe(paneRef.current);
    window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
  }, [fit, q]);

  const ping = (m) => { setToast(m); setTimeout(() => setToast(''), 1800); };
  const set = (k, v) => setQ((s) => ({ ...s, [k]: v }));
  const setItem = (i, k, v) => setQ((s) => { const items = s.items.map((it, j) => j === i ? { ...it, [k]: v } : it); return { ...s, items }; });
  const addItem = () => setQ((s) => ({ ...s, items: [...s.items, blankItem()] }));
  const removeItem = (i) => setQ((s) => { const items = s.items.filter((_, j) => j !== i); return { ...s, items: items.length ? items : [blankItem()] }; });

  // بناء نسخة محدّثة الحالة مع تسجيل الانتقال والطوابع الزمنية
  function withStatus(s, ns) {
    const now = Date.now();
    const patch = { ...s, status: ns, status_history: [...(s.status_history || []), { status: ns, at: now }] };
    if (ns === 'sent' && !s.sent_at) patch.sent_at = now;
    if (ns === 'accepted' || ns === 'rejected') patch.decided_at = now;
    if (ns !== 'rejected') patch.rejection_reason = '';
    return patch;
  }
  // تغيير الحالة: يحدّث الواجهة ويحفظ في Supabase فوراً إن كان العرض محفوظاً
  async function changeStatus(ns) {
    if (ns === q.status) return;
    const patch = withStatus(q, ns);
    setQ(patch);
    if (patch.id) {
      try { await updateQuote(patch.id, patch); await refreshList(); } catch (e) { ping('تعذّر تحديث الحالة'); }
    }
  }
  // عند تغيير الحالة إلى «مقبول»: اقترح إضافة العميل لقائمة العملاء (مرة واحدة)
  function onStatusChange(ns) {
    changeStatus(ns);
    if (ns === 'accepted' && (q.client || '').trim() && !q.linked_client_id) setClientPrompt(true);
  }
  // ربط العرض بمعرّف عميل + حفظ فوري إن كان محفوظاً
  async function linkClient(clientId) {
    const patch = { ...q, linked_client_id: clientId };
    setQ(patch);
    if (patch.id) { try { await updateQuote(patch.id, patch); await refreshList(); } catch (e) { /* يُحفظ لاحقاً */ } }
  }
  // إضافة العميل إلى Supabase (بنقرة واحدة) مع فحص التكرار بالاسم
  async function addClientFromQuote() {
    const name = (q.client || '').trim();
    if (!name) return;
    setAddingClient(true);
    try {
      const existing = (await getClients()).find((c) => (c.name || '').trim() === name);
      if (existing) {
        await linkClient(existing.id);
        ping('العميل موجود مسبقاً — تم الربط ✓');
      } else {
        const created = await createClient({ name, notes: `أُضيف من عرض سعر ${q.number}` });
        await linkClient(created.id);
        ping('تمت إضافة العميل ✓');
      }
      setClientPrompt(false);
    } catch (e) {
      ping('تعذّرت الإضافة، حاول لاحقاً');
    }
    setAddingClient(false);
  }

  async function save() {
    setSaving(true);
    try {
      const saved = q.id ? await updateQuote(q.id, q) : await createQuote(q);
      setQ(saved);
      await refreshList();
      ping('تم حفظ العرض ✓');
    } catch (e) { ping('تعذّر الحفظ، حاول لاحقاً'); }
    setSaving(false);
  }
  // تصدير PDF باسم «عرض سعر - اسم العميل» (المتصفح يشتق اسم الملف من document.title)
  function exportPdf() {
    const prev = document.title;
    const safe = (q.client || '').trim().replace(/[\\/:*?"<>|]/g, ' ').trim();
    document.title = safe ? `عرض سعر - ${safe}` : `عرض سعر ${q.number}`;
    const restore = () => { document.title = prev; window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    window.print();
    setTimeout(restore, 1500); // احتياطي إن لم يُطلق afterprint
  }
  async function newQuote() {
    let num = '';
    try { num = await nextQuoteNumber(); } catch (e) { /* بلا رقم مؤقتاً */ }
    setQ({ ...defaults(), number: num });
    ping('عرض جديد');
  }
  async function openQuote(id) {
    try { const rec = await getQuote(id); setQ(rec); setDrawer(false); ping('تم فتح ' + rec.number); }
    catch (e) { ping('تعذّر فتح العرض'); }
  }
  async function duplicate(id, e) {
    e.stopPropagation();
    try {
      const [rec, num] = await Promise.all([getQuote(id), nextQuoteNumber()]);
      setQ({ ...rec, id: null, number: num, status: 'draft', linked_client_id: null, sent_at: null, decided_at: null, rejection_reason: '', status_history: [{ status: 'draft', at: Date.now() }] });
      setDrawer(false); ping('نسخة جديدة ' + num);
    } catch (err) { ping('تعذّر التكرار'); }
  }
  async function remove(id, e) {
    e.stopPropagation();
    if (!confirm('حذف هذا العرض نهائياً؟')) return;
    try {
      await removeQuote(id);
      if (q.id === id) await newQuote();
      await refreshList();
      ping('تم الحذف');
    } catch (err) { ping('تعذّر الحذف'); }
  }

  const grand = q.items.reduce((s, it) => s + lineTotal(it), 0);

  function openFromBoard(id) { openQuote(id); setView('editor'); }

  // مؤشرات لوحة المتابعة
  const followupList = list.filter(needsFollowup);
  const closedN = list.filter((r) => ['accepted', 'rejected', 'expired'].includes(effectiveStatus(r))).length;
  const acceptedN = list.filter((r) => effectiveStatus(r) === 'accepted').length;
  const winRate = closedN ? Math.round((acceptedN / closedN) * 100) : 0;
  const pipeline = list.filter((r) => ['sent', 'negotiation'].includes(effectiveStatus(r))).reduce((s, r) => s + quoteAmount(r), 0);
  const byColumn = Object.fromEntries(BOARD_COLUMNS.map((c) => [c, list.filter((r) => effectiveStatus(r) === c)]));

  return (
    <div className="qg-root">
      <style>{CSS}</style>

      <div className="qg-tabs">
        <button className={view === 'editor' ? 'active' : ''} onClick={() => setView('editor')}>✎ مُنشئ العرض</button>
        <button className={view === 'board' ? 'active' : ''} onClick={() => { refreshList(); setView('board'); }}>
          📊 لوحة المتابعة{followupList.length > 0 && <span className="qg-tabbadge">{followupList.length}</span>}
        </button>
        {loading && <span className="qg-loading">⏳ جارٍ التحميل…</span>}
      </div>

      {view === 'board' ? (
        <Board byColumn={byColumn} stats={{ followup: followupList.length, winRate, pipeline, total: list.length }}
          onOpen={openFromBoard} activeId={q.id} />
      ) : (
      <>
      <div className="qg-bar">
        <span className="qg-qnum">رقم العرض: <b>{q.number}</b></span>
        <select className="qg-status" value={q.status} onChange={(e) => onStatusChange(e.target.value)}>
          <option value="draft">مسودة</option><option value="sent">مُرسل</option>
          <option value="negotiation">تفاوض</option>
          <option value="accepted">مقبول</option><option value="rejected">مرفوض</option>
        </select>
        <div className="qg-spacer" />
        <button className="qg-btn" onClick={() => { refreshList(); setDrawer(true); }}>🗂️ السجل</button>
        <button className="qg-btn" onClick={newQuote} disabled={saving}>＋ عرض جديد</button>
        <button className="qg-btn" onClick={save} disabled={saving}>{saving ? '⏳ جارٍ الحفظ…' : '💾 حفظ'}</button>
        <button className="qg-btn qg-primary" onClick={exportPdf}>⤓ تصدير PDF</button>
      </div>

      <div className="qg-workspace">
        {/* form */}
        <div className="qg-form">
          <h3>بيانات العميل</h3>
          <label className="qg-f"><span>اسم العميل</span><input value={q.client} onChange={(e) => set('client', e.target.value)} placeholder="اسم العميل" /></label>
          <label className="qg-f"><span>التاريخ</span><input type="date" value={q.date} onChange={(e) => set('date', e.target.value)} /></label>

          <h3>وصف المشروع</h3>
          <label className="qg-f"><textarea value={q.desc} onChange={(e) => set('desc', e.target.value)} /></label>

          <h3>الباقة — البنود</h3>
          <div className="qg-ihead"><span>الخدمة</span><span>التكلفة/يوم</span><span>أيام</span><span>الخصم</span><span /></div>
          {q.items.map((it, i) => (
            <div className="qg-irow" key={i}>
              <input value={it.svc} onChange={(e) => setItem(i, 'svc', e.target.value)} placeholder="الخدمة" />
              <input type="number" value={it.cost} onChange={(e) => setItem(i, 'cost', e.target.value)} />
              <input type="number" value={it.days} onChange={(e) => setItem(i, 'days', e.target.value)} />
              <input type="number" value={it.discount} onChange={(e) => setItem(i, 'discount', e.target.value)} />
              <button className="qg-del" onClick={() => removeItem(i)}>×</button>
            </div>
          ))}
          <button className="qg-add" onClick={addItem}>＋ إضافة بند</button>
          <label className="qg-f" style={{ marginTop: 12 }}><span>ملاحظة أسفل الجدول</span><textarea value={q.note} onChange={(e) => set('note', e.target.value)} /></label>

          <h3>ميزانية الأدوات</h3>
          <label className="qg-switch"><input type="checkbox" checked={q.toolsShow} onChange={(e) => set('toolsShow', e.target.checked)} /> إظهار قسم ميزانية الأدوات</label>
          <div className="qg-row2">
            <label className="qg-f"><span>الحد الأدنى</span><input type="number" value={q.toolsMin} onChange={(e) => set('toolsMin', e.target.value)} /></label>
            <label className="qg-f"><span>الحد الأعلى</span><input type="number" value={q.toolsMax} onChange={(e) => set('toolsMax', e.target.value)} /></label>
          </div>

          <h3>الصلاحية</h3>
          <label className="qg-f"><textarea value={q.validity} onChange={(e) => set('validity', e.target.value)} /></label>

          <h3>المتابعة</h3>
          <label className="qg-f"><span>مدة صلاحية العرض (أيام)</span><input type="number" value={q.validityDays} onChange={(e) => set('validityDays', e.target.value)} /></label>
          {validUntil(q) && <div className="qg-hint">ينتهي في: <b>{fmtQuoteDate(validUntil(q))}</b></div>}
          {q.status === 'rejected' && (
            <label className="qg-f"><span>سبب الرفض</span>
              <select className="qg-fselect" value={q.rejection_reason} onChange={(e) => set('rejection_reason', e.target.value)}>
                <option value="">— اختر —</option>
                {Object.entries(REJECTION_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          )}
          {q.status_history && q.status_history.length > 0 && (
            <div className="qg-timeline">
              {[...q.status_history].reverse().map((h, i) => {
                const bd = STATUS[h.status] || ['', h.status];
                return <div className="qg-tl" key={i}><span className={`qg-badge ${bd[0]}`}>{bd[1]}</span><span className="qg-tlt">{fmtQuoteDate(new Date(h.at).toISOString().slice(0, 10))}</span></div>;
              })}
            </div>
          )}
        </div>

        {/* preview */}
        <div className="qg-preview" ref={paneRef}>
          <div className="qg-scaler" style={{ transform: `scale(${scale})`, height: pageRef.current ? pageRef.current.offsetHeight * scale : 'auto' }}>
            <div className="qg-a4" ref={pageRef}>
              <div className="qg-a4-page" ref={innerRef} style={{ transform: contentScale < 1 ? `scale(${contentScale})` : undefined }}>
              <div className="qg-ph">
                <div className="qg-htxt"><div className="qg-title">عرض سعر</div><div className="qg-sub">تنظيم وترتيب</div></div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/tarteeb-logo.png" alt="شعار ترتيب" />
              </div>
              <div className="qg-meta">
                <div><div className="qg-lbl">اسم العميل:</div><div className="qg-val">{q.client || '[ اسم العميل ]'}</div></div>
                <div><div className="qg-lbl">التاريخ:</div><div className="qg-val">{fmtQuoteDate(q.date)}</div></div>
              </div>

              <Section n="01" title="وصف المشروع"><div className="qg-desc">{q.desc}</div></Section>

              <Section n="02" title="عرضنا — الباقة">
                <div className="qg-thead"><div className="r">الخدمة</div><div>التكلفة/اليوم</div><div>عدد الأيام</div><div>الخصم</div><div>المجموع</div></div>
                {q.items.map((it, i) => (
                  <div className="qg-trow" key={i}>
                    <div className="svc">{it.svc}</div>
                    <div className="c"><Money v={it.cost} /></div>
                    <div className="c">{Number(it.days) || 0}</div>
                    <div className="c"><Money v={it.discount} /></div>
                    <div className="tot"><Money v={lineTotal(it)} /></div>
                  </div>
                ))}
                <div className="qg-ttotal"><div className="lbl">الإجمالي</div><div className="v"><Money v={grand} /></div></div>
                {q.note && <div className="qg-note">{q.note}</div>}
              </Section>

              {q.toolsShow && (
                <Section n="03" title="ميزانية الأدوات والمستلزمات">
                  <div className="qg-budget">
                    <div>بناءً على متطلبات غرفة التخزين، تتراوح التكلفة التقديرية للأدوات والمستلزمات التنظيمية بين <strong>{fmtNum(q.toolsMin)}</strong> و<strong>{fmtNum(q.toolsMax)}</strong> ريال سعودي، عند الحاجة.</div>
                    <div>ستتم مشاركة قائمة تفصيلية بالمواد المطلوبة وأسعارها مع العميل قبل الشراء، للحصول على الموافقة النهائية.</div>
                  </div>
                </Section>
              )}

              <div className="qg-bottom">
                {q.validity && <div className="qg-validity">{q.validity}</div>}
                <div className="qg-foot">
                  <span>المملكة العربية السعودية، الرياض</span>
                  <span>tarteebandmore.com</span>
                  <span dir="ltr">He@tarteebandmore.com</span>
                  <span dir="ltr">+966 55 600 6361</span>
                </div>
              </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </>
      )}

      {/* history drawer */}
      {drawer && <div className="qg-scrim" onClick={() => setDrawer(false)} />}
      <div className={`qg-drawer${drawer ? ' open' : ''}`}>
        <div className="qg-dhead"><h3>🗂️ العروض المحفوظة</h3><button className="qg-btn" onClick={() => setDrawer(false)}>✕</button></div>
        <div className="qg-dlist">
          {list.length === 0 && <div className="qg-empty">لا توجد عروض محفوظة بعد.<br />أنشئ عرضاً واضغط «حفظ».</div>}
          {list.map((rec) => {
            const g = quoteAmount(rec);
            const bd = STATUS[effectiveStatus(rec)];
            return (
              <div key={rec.id} className={`qg-qcard${rec.id === q.id ? ' active' : ''}`} onClick={() => openQuote(rec.id)}>
                <div className="qg-qtop"><span className="qg-qn">{rec.number}</span><span className={`qg-badge ${bd[0]}`}>{bd[1]}</span></div>
                <div className="qg-qclient">{rec.client || '[ بدون اسم ]'}{needsFollowup(rec) && <span className="qg-fu">⚠ متابعة</span>}</div>
                <div className="qg-qmeta"><span>{fmtQuoteDate(rec.date)}</span><span dir="ltr">{RIYAL} {fmtNum(g)}</span></div>
                <div className="qg-qact"><button onClick={(e) => duplicate(rec.id, e)}>تكرار</button><button onClick={(e) => remove(rec.id, e)}>حذف</button></div>
              </div>
            );
          })}
        </div>
      </div>

      {clientPrompt && (
        <div className="qg-modal-bg" onClick={() => !addingClient && setClientPrompt(false)}>
          <div className="qg-modal" onClick={(e) => e.stopPropagation()}>
            <div className="qg-modal-ic">✓</div>
            <h3>تم قبول العرض 🎉</h3>
            <p>هل تريد إضافة <b>{q.client || 'هذا العميل'}</b> إلى قائمة العملاء؟</p>
            <div className="qg-modal-act">
              <button className="qg-btn qg-primary" disabled={addingClient} onClick={addClientFromQuote}>{addingClient ? 'جارٍ الإضافة…' : 'نعم، أضِفه'}</button>
              <button className="qg-btn" disabled={addingClient} onClick={() => setClientPrompt(false)}>لا، شكراً</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="qg-toast">{toast}</div>}
    </div>
  );
}

function Section({ n, title, children }) {
  return (
    <div className="qg-sec">
      <div className="qg-sh"><div className="qg-snum">{n}</div><div className="qg-stitle">{title}</div></div>
      {children}
    </div>
  );
}

function Kpi({ label, value, tone }) {
  return <div className={`qg-kpi ${tone}`}><div className="qg-kpil">{label}</div><div className="qg-kpiv">{value}</div></div>;
}

function Board({ byColumn, stats, onOpen, activeId }) {
  return (
    <div className="qg-board">
      <div className="qg-kpis">
        <Kpi label="تحتاج متابعة" value={stats.followup} tone="warn" />
        <Kpi label="معدل النجاح" value={`${stats.winRate}%`} tone="ok" />
        <Kpi label="القيمة المعلّقة" value={<span dir="ltr"><span className="qg-riyal">{RIYAL}</span> {fmtNum(stats.pipeline)}</span>} tone="teal" />
        <Kpi label="إجمالي العروض" value={stats.total} tone="ink" />
      </div>
      <div className="qg-cols">
        {BOARD_COLUMNS.map((col) => {
          const items = byColumn[col] || [];
          const bd = STATUS[col];
          const sum = items.reduce((s, r) => s + quoteAmount(r), 0);
          return (
            <div className="qg-col" key={col}>
              <div className="qg-colhead"><span className={`qg-badge ${bd[0]}`}>{bd[1]}</span><span className="qg-colcount">{items.length}</span></div>
              <div className="qg-colbody">
                {items.length === 0 && <div className="qg-colempty">—</div>}
                {items.map((rec) => {
                  const fu = needsFollowup(rec);
                  const vu = validUntil(rec);
                  return (
                    <div key={rec.id} className={`qg-bcard${rec.id === activeId ? ' active' : ''}${fu ? ' fu' : ''}`} onClick={() => onOpen(rec.id)}>
                      <div className="qg-btop"><span className="qg-qn">{rec.number}</span>{fu && <span className="qg-futag">⚠ متابعة</span>}</div>
                      <div className="qg-bclient">{rec.client || '[ بدون اسم ]'}</div>
                      <div className="qg-bmeta"><span dir="ltr"><span className="qg-riyal">{RIYAL}</span> {fmtNum(quoteAmount(rec))}</span><span>{fmtQuoteDate(rec.date)}</span></div>
                      {(col === 'sent' || col === 'negotiation') && vu && <div className="qg-bexp">ينتهي: {fmtQuoteDate(vu)}</div>}
                    </div>
                  );
                })}
              </div>
              {items.length > 0 && <div className="qg-colfoot"><span dir="ltr"><span className="qg-riyal">{RIYAL}</span> {fmtNum(sum)}</span></div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CSS = `
.qg-root{--tl:#17A2A6;--tld:#0E7E82;--cor:#E2705F;--sal:#F2988C;--lbg:#E9F8F8;--pink:#FCDAD5;--pink2:#FDEEEB;--tink:#2B3A42;--tmut:#55666E;--tbd:#E4F2F2;font-family:'IBM Plex Sans Arabic','Saudi Riyal',sans-serif;color:var(--tink)}
.qg-bar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:10px;padding:12px 4px;flex-wrap:wrap;background:transparent;margin-bottom:6px}
.qg-qnum{font-size:12px;color:var(--tmut);font-weight:600}.qg-qnum b{color:var(--tl)}
.qg-status{font-family:inherit;font-size:12px;font-weight:600;border:1px solid var(--tbd);border-radius:8px;padding:7px 10px;background:#fff;cursor:pointer;color:var(--tink)}
.qg-spacer{flex:1}
.qg-btn{border:1px solid var(--tbd);background:#fff;color:var(--tink);font-family:inherit;font-size:13px;font-weight:600;padding:8px 14px;border-radius:9px;cursor:pointer;transition:.15s}
.qg-btn:hover{border-color:var(--tl);color:var(--tl)}
.qg-primary{background:var(--tl);color:#fff;border-color:var(--tl)}.qg-primary:hover{background:var(--tld);color:#fff}
.qg-workspace{display:grid;grid-template-columns:360px 1fr;gap:16px;align-items:start}
@media(max-width:900px){.qg-workspace{grid-template-columns:1fr}}
.qg-form{background:#fff;border:1px solid var(--tbd);border-radius:16px;padding:18px;position:sticky;top:64px;max-height:calc(100vh - 90px);overflow:auto}
@media(max-width:900px){.qg-form{position:static;max-height:none}}
.qg-form h3{font-size:13px;color:var(--tl);font-weight:700;margin:16px 0 9px}.qg-form h3:first-child{margin-top:0}
.qg-f{display:block;margin-bottom:11px}
.qg-f>span{display:block;font-size:12px;font-weight:600;color:var(--tmut);margin-bottom:5px}
.qg-f input,.qg-f textarea,.qg-irow input{width:100%;font-family:inherit;font-size:13px;color:var(--tink);border:1px solid var(--tbd);border-radius:8px;padding:9px 11px;background:#fff}
.qg-f textarea{resize:vertical;min-height:60px;line-height:1.7}
.qg-f input:focus,.qg-f textarea:focus,.qg-irow input:focus{outline:none;border-color:var(--tl)}
.qg-row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.qg-ihead,.qg-irow{display:grid;grid-template-columns:1fr 62px 42px 54px 26px;gap:6px;align-items:center}
.qg-ihead{font-size:10px;color:var(--tmut);font-weight:700;margin-bottom:6px;padding:0 2px}
.qg-irow{margin-bottom:7px}.qg-irow input{padding:7px 8px;font-size:12px}
.qg-del{border:none;background:var(--pink2);color:var(--cor);width:26px;height:30px;border-radius:7px;cursor:pointer;font-size:15px;line-height:1}
.qg-add{font-size:12px;color:var(--tl);background:var(--lbg);border:1px dashed var(--tl);border-radius:8px;padding:8px;width:100%;cursor:pointer;font-family:inherit;font-weight:600;margin-top:2px}
.qg-switch{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--tmut);cursor:pointer;margin-bottom:8px}
.qg-switch input{width:auto}
.qg-preview{overflow:auto;border-radius:16px}
.qg-scaler{transform-origin:top center;margin:0 auto}
.qg-a4{width:210mm;height:297mm;overflow:hidden;background:#fff;box-shadow:0 6px 30px rgba(0,0,0,.10);position:relative}
.qg-a4-page{width:210mm;min-height:297mm;display:flex;flex-direction:column;color:var(--tink);transform-origin:top center;background:#fff}
.qg-riyal{font-family:'Saudi Riyal','IBM Plex Sans Arabic',sans-serif}
.qg-ph{display:flex;justify-content:space-between;align-items:center;padding:32px 48px 0 48px}
.qg-title{font-size:46px;font-weight:700;color:var(--tl);line-height:1.2}
.qg-sub{font-size:14px;color:var(--sal);font-weight:600;letter-spacing:.5px}
.qg-ph img{width:240px;height:auto}
.qg-meta{display:flex;justify-content:space-between;gap:24px;margin:22px 48px 0 48px;padding:14px 24px;background:var(--lbg);border-radius:12px;align-items:center}
.qg-lbl{font-size:12px;color:var(--tl);font-weight:700}.qg-val{font-size:14px;font-weight:500}
.qg-sec{margin:18px 48px 0 48px}
.qg-sh{display:flex;align-items:center;gap:12px;margin-bottom:10px}
.qg-snum{width:34px;height:34px;border-radius:50%;background:var(--tl);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0}
.qg-stitle{font-size:18px;font-weight:700;color:var(--tl)}
.qg-desc{background:var(--pink);border-radius:10px;padding:16px 22px;font-size:14px;line-height:1.85;text-align:right;white-space:pre-wrap}
.qg-brief{font-size:14px;color:var(--tmut);text-align:right;margin-bottom:14px}.qg-brief strong{color:var(--cor)}
.qg-cs{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.qg-card{border:1px solid var(--tbd);border-radius:10px;padding:18px 22px;text-align:right}
.qg-t{font-size:13px;font-weight:700;margin-bottom:8px}.qg-t.chal{color:var(--cor)}.qg-t.sol{color:var(--tl)}
.qg-b{font-size:13px;line-height:1.9;color:var(--tmut);white-space:pre-wrap}
.qg-thead,.qg-trow,.qg-ttotal{display:grid;grid-template-columns:2.2fr 1fr .8fr .9fr 1fr;gap:8px}
.qg-thead{background:var(--tl);color:#fff;border-radius:10px 10px 0 0;padding:12px 18px;font-size:13px;font-weight:700}
.qg-thead .r{text-align:right}.qg-thead>div:not(.r){text-align:center}
.qg-trow{padding:13px 18px;font-size:14px;border-bottom:1px solid var(--tbd);align-items:center}
.qg-trow .svc{font-weight:500;text-align:right}.qg-trow .c{text-align:center;color:var(--tmut)}.qg-trow .tot{text-align:center;font-weight:600}
.qg-ttotal{padding:10px 18px;font-size:16px;background:var(--pink2);border-radius:0 0 8px 8px}
.qg-ttotal .lbl{grid-column:1 / 5;text-align:left;color:var(--cor);font-weight:700}
.qg-ttotal .v{text-align:center;color:var(--cor);font-weight:700}
.qg-note{font-size:12px;color:#7A8A92;text-align:right;margin-top:10px;line-height:1.8}
.qg-budget{border:1px solid var(--tbd);border-radius:10px;padding:18px 22px;text-align:right;font-size:13px;line-height:1.9;color:var(--tmut);display:flex;flex-direction:column;gap:10px}
.qg-budget strong{color:var(--tink)}
.qg-bottom{margin-top:auto;padding-top:16px}
.qg-validity{margin:0 48px;background:var(--lbg);border-radius:10px;padding:12px 22px;font-size:13px;color:var(--tld);text-align:center;font-weight:600}
.qg-foot{display:flex;justify-content:space-between;gap:10px 12px;padding:16px 48px 20px 48px;border-top:1px solid var(--tbd);margin:16px 48px 0 48px;font-size:11px;color:var(--tmut);overflow:hidden}
.qg-foot span{white-space:nowrap}
.qg-scrim{position:fixed;inset:0;background:rgba(20,40,45,.35);z-index:60}
.qg-drawer{position:fixed;top:0;left:0;height:100%;width:360px;max-width:90vw;background:#fff;z-index:61;box-shadow:2px 0 24px rgba(0,0,0,.15);transform:translateX(-100%);transition:transform .22s;display:flex;flex-direction:column}
.qg-drawer.open{transform:translateX(0)}
.qg-dhead{padding:16px 18px;border-bottom:1px solid var(--tbd);display:flex;align-items:center;justify-content:space-between}
.qg-dhead h3{font-size:15px;color:var(--tl);font-weight:700}
.qg-dlist{overflow:auto;padding:10px;flex:1}
.qg-qcard{border:1px solid var(--tbd);border-radius:10px;padding:12px;margin-bottom:9px;cursor:pointer;transition:.15s}
.qg-qcard:hover{border-color:var(--tl);background:#FAFEFE}.qg-qcard.active{border-color:var(--tl);background:var(--lbg)}
.qg-qtop{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
.qg-qn{font-size:12px;font-weight:700;color:var(--tl)}
.qg-badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px}
.qg-b-draft{background:#EEF2F3;color:#67787F}.qg-b-sent{background:#E5F3FF;color:#1E7FC2}
.qg-b-nego{background:#FFF3E0;color:#C77A18}.qg-b-expired{background:#F3EDF7;color:#8257A8}
.qg-b-accepted{background:#E4F7EC;color:#1B9E54}.qg-b-rejected{background:#FDEBE8;color:#D0503C}
.qg-fu{margin-inline-start:8px;font-size:10px;font-weight:700;color:#C77A18}
.qg-fselect{width:100%;font-family:inherit;font-size:13px;color:var(--tink);border:1px solid var(--tbd);border-radius:8px;padding:9px 11px;background:#fff;cursor:pointer}
.qg-hint{font-size:12px;color:var(--tmut);margin:-4px 0 10px}.qg-hint b{color:var(--tl)}
.qg-timeline{display:flex;flex-direction:column;gap:6px;margin-top:6px;border-top:1px dashed var(--tbd);padding-top:10px}
.qg-tl{display:flex;align-items:center;justify-content:space-between;font-size:11px}.qg-tlt{color:var(--tmut)}
/* التبويبات */
.qg-tabs{display:flex;gap:8px;margin-bottom:12px}
.qg-tabs button{position:relative;font-family:inherit;font-size:14px;font-weight:600;padding:9px 18px;border-radius:10px;border:1px solid var(--tbd);background:#fff;color:var(--tmut);cursor:pointer}
.qg-tabs button.active{background:var(--tl);color:#fff;border-color:var(--tl)}
.qg-tabbadge{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;margin-inline-start:6px;border-radius:20px;background:#E2705F;color:#fff;font-size:11px;font-weight:700}
.qg-loading{align-self:center;font-size:12px;font-weight:600;color:var(--tmut)}
/* لوحة المتابعة */
.qg-board{display:flex;flex-direction:column;gap:16px}
.qg-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
@media(max-width:760px){.qg-kpis{grid-template-columns:repeat(2,1fr)}}
.qg-kpi{background:#fff;border:1px solid var(--tbd);border-radius:14px;padding:14px 16px;border-inline-start:4px solid var(--tl)}
.qg-kpi.warn{border-inline-start-color:#E2705F}.qg-kpi.ok{border-inline-start-color:#1B9E54}
.qg-kpi.teal{border-inline-start-color:var(--tl)}.qg-kpi.ink{border-inline-start-color:#67787F}
.qg-kpil{font-size:12px;color:var(--tmut);font-weight:600;margin-bottom:6px}
.qg-kpiv{font-size:24px;font-weight:700;color:var(--tink)}
.qg-cols{display:grid;grid-template-columns:repeat(6,minmax(150px,1fr));gap:10px;overflow-x:auto;padding-bottom:6px}
@media(max-width:1100px){.qg-cols{grid-auto-flow:column;grid-template-columns:none;grid-auto-columns:minmax(180px,1fr)}}
.qg-col{background:#F6FAFA;border:1px solid var(--tbd);border-radius:12px;padding:8px;display:flex;flex-direction:column;min-height:120px}
.qg-colhead{display:flex;align-items:center;justify-content:space-between;padding:4px 4px 8px}
.qg-colcount{font-size:12px;font-weight:700;color:var(--tmut)}
.qg-colbody{display:flex;flex-direction:column;gap:8px;flex:1}
.qg-colempty{text-align:center;color:#B7C4C9;font-size:16px;padding:10px}
.qg-bcard{background:#fff;border:1px solid var(--tbd);border-radius:10px;padding:10px;cursor:pointer;transition:.15s}
.qg-bcard:hover{border-color:var(--tl);box-shadow:0 2px 8px rgba(0,0,0,.06)}
.qg-bcard.active{border-color:var(--tl);background:#FAFEFE}
.qg-bcard.fu{border-inline-start:3px solid #E2705F}
.qg-btop{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
.qg-btop .qg-qn{font-size:12px;font-weight:700;color:var(--tl)}
.qg-futag{font-size:10px;font-weight:700;color:#E2705F}
.qg-bclient{font-size:13px;font-weight:600;color:var(--tink)}
.qg-bmeta{display:flex;justify-content:space-between;font-size:11px;color:var(--tmut);margin-top:4px}
.qg-bexp{font-size:10px;color:#C77A18;margin-top:4px}
.qg-colfoot{padding:8px 4px 2px;font-size:12px;font-weight:700;color:var(--tink);text-align:center;border-top:1px dashed var(--tbd);margin-top:6px}
.qg-qclient{font-size:14px;font-weight:600}
.qg-qmeta{font-size:11px;color:var(--tmut);margin-top:3px;display:flex;justify-content:space-between}
.qg-qact{display:flex;gap:6px;margin-top:8px}
.qg-qact button{font-size:11px;border:1px solid var(--tbd);background:#fff;border-radius:6px;padding:4px 8px;cursor:pointer;font-family:inherit;color:var(--tmut)}
.qg-qact button:hover{border-color:var(--cor);color:var(--cor)}
.qg-empty{text-align:center;color:var(--tmut);font-size:13px;padding:40px 20px}
.qg-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--tink);color:#fff;font-size:13px;font-weight:600;padding:11px 20px;border-radius:10px;z-index:70}
.qg-modal-bg{position:fixed;inset:0;background:rgba(20,40,45,.4);z-index:80;display:flex;align-items:center;justify-content:center;padding:20px}
.qg-modal{background:#fff;border-radius:16px;padding:26px 24px;width:340px;max-width:90vw;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.2)}
.qg-modal-ic{width:52px;height:52px;border-radius:50%;background:#E4F7EC;color:#1B9E54;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700;margin:0 auto 14px}
.qg-modal h3{font-size:17px;font-weight:700;color:var(--tink);margin-bottom:8px}
.qg-modal p{font-size:14px;color:var(--tmut);line-height:1.8;margin-bottom:18px}.qg-modal p b{color:var(--tl)}
.qg-modal-act{display:flex;gap:10px;justify-content:center}
.qg-modal-act .qg-btn{flex:1}
@media print{
  @page{size:A4;margin:0}
  body{background:#fff !important}
  .app>*{visibility:hidden}
  .qg-a4,.qg-a4 *{visibility:visible}
  .qg-scaler{transform:none !important;height:auto !important}
  .qg-a4{position:absolute;top:0;left:0;box-shadow:none;width:210mm;height:297mm;overflow:hidden;page-break-inside:avoid;break-inside:avoid}
  .qg-bar,.qg-form,.qg-drawer,.qg-scrim,.qg-toast{display:none !important}
}
`;
