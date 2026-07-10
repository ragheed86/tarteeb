'use client';
// مودال موحّد — يولّد نفس بنية DOM المعتمدة في globals.css
// (modal-backdrop / modal-card / modal-head / modal-actions) فلا يتغير أي CSS،
// ويستبدل النسخ اليدوية المكررة في الصفحات مع سلوك موحّد:
// إغلاق بالنقر على الخلفية + Escape + قفل تمرير الصفحة + إدارة التركيز.
import { useEffect, useRef } from 'react';

const SIZE_CLASS = { sm: 'modal-sm', md: '', lg: 'project-modal' };

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  as = 'div',
  onSubmit,
  size = 'md',
  className = '',
  footer,
  children,
}) {
  const cardRef = useRef(null);
  const lastFocused = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    lastFocused.current = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // التركيز على أول حقل إدخال داخل المودال (أو البطاقة نفسها)
    const card = cardRef.current;
    const first = card?.querySelector('input,select,textarea,button:not(.icon-close)');
    (first || card)?.focus?.();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      lastFocused.current?.focus?.();
    };
  }, [open, onClose]);

  // حبس Tab داخل المودال
  function trapTab(e) {
    if (e.key !== 'Tab') return;
    const card = cardRef.current;
    if (!card) return;
    const focusables = card.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  if (!open) return null;
  const Tag = as;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <Tag
        ref={cardRef}
        className={`modal-card ${SIZE_CLASS[size] || ''} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        onSubmit={onSubmit}
        onKeyDown={trapTab}
        tabIndex={-1}
      >
        {(title || subtitle) && (
          <div className="modal-head">
            <div>
              {title && <h2>{title}</h2>}
              {subtitle && <p>{subtitle}</p>}
            </div>
            <button type="button" className="icon-close" onClick={onClose} aria-label="إغلاق">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
        )}
        {children}
        {footer && <div className="modal-actions">{footer}</div>}
      </Tag>
    </div>
  );
}
