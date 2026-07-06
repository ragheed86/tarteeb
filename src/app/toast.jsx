'use client';
import { useEffect, useState } from 'react';

// نظام تنبيهات موحّد: toast('تم الحفظ') أو toast('تعذّر الحذف', 'err')
// يعمل عبر حدث نافذة فلا يحتاج Context ولا تمرير props
export function toast(message, type = 'ok') {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('app-toast', { detail: { message, type } }));
  }
}

export function Toaster() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    function onToast(e) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setItems((s) => [...s.slice(-2), { id, ...e.detail }]);
      setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 3400);
    }
    window.addEventListener('app-toast', onToast);
    return () => window.removeEventListener('app-toast', onToast);
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="toaster" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          {t.type === 'err' ? (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12.5 9.5 18 20 6.5" /></svg>
          )}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
