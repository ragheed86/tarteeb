'use client';
import Link from 'next/link';
import { useLanguage } from '@/i18n/LanguageProvider';

export default function NotFound() {
  const { t } = useLanguage();
  return (
    <div className="card access-denied">
      <div className="mark"><span /><span /><span /><span /></div>
      <h2>{t('notFound.title')}</h2>
      <p>{t('notFound.description')}</p>
      <Link className="btn" href="/" style={{ marginTop: 14, display: 'inline-flex' }}>{t('notFound.back')}</Link>
    </div>
  );
}
