const conversations = [
  ['ن', 'نورة العتيبي', 'واتساب', 'ch-wa', 'تمام، نشوفكم بكرة الساعة 11', '9:42 ص'],
  ['ر', 'ريم القحطاني', 'تيليجرام', 'ch-tg', 'حابة أعرف تفاصيل باكج النقل', 'أمس'],
  ['ع', 'عبدالله الشهري', 'بريد', 'ch-ml', 'وصلتني الفاتورة، شكراً لكم', 'أمس'],
  ['س', 'سارة المطيري', 'واتساب', 'ch-wa', 'ممكن نأجل الزيارة ليوم الأحد؟', 'السبت'],
];

export default function InboxPage() {
  return (
    <>
      <div className="sec-head">
        <h2>صندوق الوارد الموحّد</h2>
        <span className="pill p-wait">يُربط بالقنوات بعد تطوير الـ Backend</span>
      </div>
      <div className="inbox">
        <div className="convlist">
          {conversations.map(([initial, name, channel, cls, msg, time], index) => (
            <div className={`conv${index === 0 ? ' active' : ''}`} key={name}>
              <div className="ca">{initial}</div>
              <div>
                <div className="cn">{name} <span className={`ch ${cls}`}>{channel}</span></div>
                <div className="cx">{msg}</div>
              </div>
              <span className="ct">{time}</span>
            </div>
          ))}
        </div>
        <div className="thread">
          <div className="th-h">
            <div className="ca">ن</div>
            <div><b>نورة العتيبي</b><br /><small>النرجس · عميل نشط · مشروع: تنظيم دواليب</small></div>
          </div>
          <div className="tl">
            <div className="daysep">الإثنين 29 يونيو</div>
            <div className="msg in"><div className="bub">السلام عليكم، أبي أعرف موعد الفريق بكرة</div><div className="meta"><span className="ch ch-wa">واتساب</span> 9:15 ص</div></div>
            <div className="msg out"><div className="bub">وعليكم السلام نورة، الفريق بيكون عندكم الساعة 11 صباحاً بإذن الله</div><div className="meta">راغد · 9:38 ص ✓✓</div></div>
            <div className="msg in"><div className="bub">تمام، نشوفكم بكرة الساعة 11</div><div className="meta"><span className="ch ch-wa">واتساب</span> 9:42 ص</div></div>
          </div>
        </div>
      </div>
      <div className="note">سجل 360 درجة لكل عميل متاح أيضاً داخل ملفه في قسم العملاء</div>
    </>
  );
}
