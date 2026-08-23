'use client';
// حقول نماذج موحّدة — تولّد بنية .field المعتمدة في globals.css نفسها،
// فتستبدل الترميز المكرر (label + input) في كل مودالات الصفحات.
import { useId } from 'react';

export function Input({ label, hint, error, ltr, className = '', ...props }) {
  const id = useId();
  const isDateControl = ['date', 'datetime-local', 'month', 'week'].includes(props.type);
  return (
    <div className={`field ${className}`.trim()}>
      {label && <label htmlFor={id}>{label}</label>}
      <input
        id={id}
        dir={ltr ? 'ltr' : undefined}
        lang={isDateControl ? 'en-GB' : props.lang}
        aria-invalid={error ? true : undefined}
        {...props}
      />
      {hint && !error && <small style={{ color: 'var(--muted)', fontSize: 'var(--fs-xs)' }}>{hint}</small>}
      {error && <small role="alert" style={{ color: 'var(--neg)', fontSize: 'var(--fs-xs)' }}>{error}</small>}
    </div>
  );
}

export function Select({ label, error, options, children, className = '', ...props }) {
  const id = useId();
  return (
    <div className={`field ${className}`.trim()}>
      {label && <label htmlFor={id}>{label}</label>}
      <select id={id} aria-invalid={error ? true : undefined} {...props}>
        {options
          ? options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
          : children}
      </select>
      {error && <small role="alert" style={{ color: 'var(--neg)', fontSize: 'var(--fs-xs)' }}>{error}</small>}
    </div>
  );
}

export function TextArea({ label, error, className = '', ...props }) {
  const id = useId();
  return (
    <div className={`field ${className}`.trim()}>
      {label && <label htmlFor={id}>{label}</label>}
      <textarea id={id} aria-invalid={error ? true : undefined} {...props} />
      {error && <small role="alert" style={{ color: 'var(--neg)', fontSize: 'var(--fs-xs)' }}>{error}</small>}
    </div>
  );
}
