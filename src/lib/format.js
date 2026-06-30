// تنسيق موحّد — الأرقام لاتينية دائماً (en-US)، التواريخ عربية بأرقام لاتينية
export function fmtNum(n) {
  return new Intl.NumberFormat('en-US').format(Number(n || 0));
}
export function fmtMoney(n) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(n || 0));
}
export function fmtDate(d) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('ar-SA-u-nu-latn', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(d));
}

// خرائط الحالات → أصناف الـ pill والتسميات العربية
export const CLIENT_STATUS = {
  lead: { label: 'عميل محتمل', cls: 'p-quote' },
  active: { label: 'عميل نشط', cls: 'p-prog' },
  completed: { label: 'مكتمل', cls: 'p-done' },
  waiting: { label: 'بانتظار رد', cls: 'p-wait' },
};
export const PROJECT_STATUS = {
  quote: { label: 'عرض سعر', cls: 'p-quote' },
  preparing: { label: 'قيد التحضير', cls: 'p-wait' },
  in_progress: { label: 'قيد التنفيذ', cls: 'p-prog' },
  delivered: { label: 'تم التسليم', cls: 'p-done' },
  completed: { label: 'مكتمل', cls: 'p-done' },
  cancelled: { label: 'ملغي', cls: 'p-cancel' },
};
export const INVOICE_STATUS = {
  draft: { label: 'مسودة', cls: 'p-wait' },
  unpaid: { label: 'غير مدفوعة', cls: 'p-quote' },
  paid: { label: 'مدفوعة', cls: 'p-done' },
  overdue: { label: 'متأخرة', cls: 'p-cancel' },
};
export const SOURCE_LABEL = {
  instagram: 'انستقرام', tiktok: 'تيك توك', referral: 'توصية صديق', other: 'أخرى',
};
