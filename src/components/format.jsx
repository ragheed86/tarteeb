'use client';
// مكوّنات المحتوى المختلط (أرقام/جوالات/أكواد داخل نص عربي) — بديل موحّد
// عن تكرار dir="ltr" و.amt يدوياً في كل صفحة. تعتمد على lib/format.js دون تعديله.
import { fmtNum, fmtMoney, fmtDate, CURRENCY } from '@/lib/format';

// رقم لاتيني معزول الاتجاه (كميات، نسب، عدّادات)
export function Num({ v, className = '' }) {
  return <span className={`amt ${className}`.trim()} dir="ltr">{fmtNum(v)}</span>;
}

// مبلغ مالي بريال سعودي — الرمز يلي الرقم داخل عزل LTR فلا ينعكس في RTL
export function Money({ v, className = '' }) {
  return <span className={`amt ${className}`.trim()} dir="ltr">{fmtMoney(v)} {CURRENCY}</span>;
}

// تاريخ منسّق (أشهر عربية بأرقام لاتينية) معزول كي لا يختلط بالنص المجاور
export function DateText({ v, className = '' }) {
  return <span className={`amt ${className}`.trim()}>{fmtDate(v)}</span>;
}

// محتوى LTR عام: جوال، بريد، كود، رابط، رقم سجل
export function Ltr({ children, className = '' }) {
  return <span className={`ltr ${className}`.trim()} dir="ltr">{children}</span>;
}

// شارة حالة موحّدة فوق خرائط الحالات في lib/format.js (CLIENT_STATUS وغيرها)
export function StatusPill({ status, map, className = '' }) {
  const s = map?.[status] || { label: status || '—', cls: 'p-wait' };
  return <span className={`pill ${s.cls} ${className}`.trim()}>{s.label}</span>;
}
