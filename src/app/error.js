'use client';

export default function Error({ error, reset }) {
  return (
    <div className="card access-denied">
      <div className="mark"><span /><span /><span /><span /></div>
      <h2>حدث خطأ غير متوقّع</h2>
      <p>{error?.message || 'تعذّر تحميل هذه الصفحة، حاول مرة أخرى.'}</p>
      <button className="btn" style={{ marginTop: 14 }} onClick={() => reset()}>إعادة المحاولة</button>
    </div>
  );
}
