'use client';
// مكوّنات حالة مشتركة (تحميل / فارغ / خطأ)
export function Loading() {
  return <div className="state"><div className="spinner" /></div>;
}
export function ErrorBar({ message }) {
  return <div className="errbar">خطأ: {message}</div>;
}
export function Empty({ title, desc }) {
  return (
    <div className="state">
      <div className="ic">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M5 8h14M5 12h14M5 16h9" /></svg>
      </div>
      <h3>{title}</h3><p>{desc}</p>
    </div>
  );
}
