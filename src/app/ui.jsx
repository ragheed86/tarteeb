'use client';
import { useLanguage } from '@/i18n/LanguageProvider';
// مكوّنات حالة مشتركة (تحميل / فارغ / خطأ)
export function Loading() {
  const { t } = useLanguage();
  return (
    <div className="skeleton" aria-busy="true" aria-label={t('state.loading')}>
      <div className="sk-bar" style={{ width: '38%' }} />
      <div className="sk-bar" />
      <div className="sk-bar" style={{ width: '82%' }} />
      <div className="sk-bar" style={{ width: '64%' }} />
    </div>
  );
}
export function ErrorBar({ message }) {
  const { t } = useLanguage();
  return <div className="errbar">{t('state.error', { message })}</div>;
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
