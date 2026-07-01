const areas = [
  ['السليمانية', '24 طلب', '86,000', 'var(--green)', '#fff'],
  ['الملقا', '19 طلب', '72,000', 'var(--green)', '#fff'],
  ['العليا', '17 طلب', '61,000', '#4C8068', '#fff'],
  ['النرجس', '15 طلب', '54,000', 'var(--sage)', '#1f3b30'],
  ['الياسمين', '12 طلب', '43,000', 'var(--sage)', '#1f3b30'],
  ['قرطبة', '9 طلبات', '31,000', '#A7CCB8', '#1f3b30'],
  ['حطين', '8 طلبات', '29,000', '#A7CCB8', '#1f3b30'],
  ['الصحافة', '7 طلبات', '24,000', 'var(--sage-bg)', 'var(--muted)'],
  ['الربيع', '6 طلبات', '20,000', 'var(--sage-bg)', 'var(--muted)'],
  ['العقيق', '5 طلبات', '17,000', 'var(--surface-2)', 'var(--faint)'],
  ['الورود', '4 طلبات', '13,000', 'var(--surface-2)', 'var(--faint)'],
  ['المروج', '3 طلبات', '9,000', 'var(--surface-2)', 'var(--faint)'],
];

export default function HeatmapPage() {
  return (
    <>
      <div className="sec-head">
        <h2>كثافة الطلبات حسب أحياء الرياض</h2>
        <span className="more">آخر 6 أشهر</span>
      </div>
      <div className="hmwrap">
        <div className="card">
          <div className="hmgrid">
            {areas.map(([name, count, revenue, bg, color]) => (
              <div className="htile" style={{ background: bg, color }} key={name}>
                <div className="hn">{name}</div>
                <div>
                  <div className="hv">{count}</div>
                  <div className="hr">{revenue} ⃁</div>
                </div>
              </div>
            ))}
          </div>
          <div className="legend">
            قليل
            <span className="sw">
              <i style={{ background: 'var(--surface-2)' }} />
              <i style={{ background: 'var(--sage-bg)' }} />
              <i style={{ background: '#A7CCB8' }} />
              <i style={{ background: 'var(--sage)' }} />
              <i style={{ background: '#4C8068' }} />
              <i style={{ background: 'var(--green)' }} />
            </span>
            كثيف
          </div>
        </div>
        <div className="card" style={{ height: 'fit-content' }}>
          <div className="sec-head"><h2>أين تصرف ميزانية الإعلان؟</h2></div>
          <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.8 }}>
            أعلى كثافة طلبات في <b style={{ color: 'var(--green)' }}>السليمانية والملقا</b>، وجّه حملات انستقرام المدفوعة لهذه الأحياء.
          </p>
          <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.8, marginTop: 10 }}>
            <b style={{ color: 'var(--gold)' }}>حطين والصحافة</b> طلب صاعد بهامش ربح أعلى، فرصة توسّع.
          </p>
          <div className="note" style={{ textAlign: 'start', marginTop: 14 }}>
            تتصل بـ Google Maps في النسخة الفعلية لعرض خريطة جغرافية حيّة بدل الشبكة.
          </div>
        </div>
      </div>
    </>
  );
}
