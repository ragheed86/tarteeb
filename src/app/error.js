'use client';
import { useLanguage } from '@/i18n/LanguageProvider';

export default function Error({ error, reset }) {
  const { t } = useLanguage();
  return (
    <div className="card access-denied">
      <div className="mark"><span /><span /><span /><span /></div>
      <h2>{t('error.title')}</h2>
      <p>{error?.message || t('error.description')}</p>
      <button className="btn" style={{ marginTop: 14 }} onClick={() => reset()}>{t('error.retry')}</button>
    </div>
  );
}
