'use client';
import { useState } from 'react';
import Modal from './Modal';
import { useLanguage } from '@/i18n/LanguageProvider';

export default function KpiCard({
  label,
  value,
  trend,
  tone = '',
  definition,
  formula,
  period,
  breakdown = [],
  note,
  children,
  className = '',
  baseClass = 'kpi',
  labelClass = 'lbl',
  valueClass = 'val',
  trendClass = 'trend',
  actionLabel,
  onAction,
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const explain = definition || t('kpi.defaultExplanation');

  return (
    <>
      <button
        type="button"
        className={`${baseClass} kpi-interactive ${tone} ${className}`.trim()}
        aria-label={t('kpi.openDetails', { label })}
        onClick={() => setOpen(true)}
      >
        <span className="kpi-info-badge" aria-hidden="true">i</span>
        <div className={labelClass}>{label}</div>
        <div className={valueClass}>{value}</div>
        {trend && <div className={trendClass}><span>{trend}</span></div>}
        {children}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        subtitle={t('kpi.subtitle')}
        size="sm"
        footer={<>{actionLabel && onAction && <button type="button" className="btn ghost" onClick={() => { setOpen(false); onAction(); }}>{actionLabel}</button>}<button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.ok')}</button></>}
      >
        <div className="kpi-detail-value">{value}</div>
        <p className="kpi-detail-definition">{explain}</p>
        {(period || formula) && (
          <div className="kpi-detail-meta">
            {period && <div><span>{t('kpi.scope')}</span><b>{period}</b></div>}
            {formula && <div><span>{t('kpi.formula')}</span><b>{formula}</b></div>}
          </div>
        )}
        {breakdown.length > 0 && (
          <div className="kpi-breakdown">
            <h3>{t('kpi.breakdown')}</h3>
            {breakdown.map((item, index) => (
              <div className="kpi-breakdown-row" key={`${item.label}-${index}`}>
                <span>{item.label}</span><b>{item.value}</b>
              </div>
            ))}
          </div>
        )}
        {note && <div className="kpi-detail-note">{note}</div>}
      </Modal>
    </>
  );
}
