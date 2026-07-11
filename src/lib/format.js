// تنسيق موحّد — الأرقام لاتينية دائماً (en-US)، التواريخ عربية بأرقام لاتينية
export const CURRENCY = '⃁'; // رمز الريال السعودي الجديد (Unicode 17.0)
export function fmtNum(n) {
  return new Intl.NumberFormat('en-US').format(Number(n || 0));
}
export function fmtMoney(n) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(n || 0));
}
export function fmtDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  return new Intl.DateTimeFormat('ar-SA-u-nu-latn', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}
// وقت نسبي مختصر لـ«آخر تحديث» — أرقام لاتينية، ويرجع للتاريخ الكامل بعد أسبوع
export function fmtRelative(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  const n = (x) => new Intl.NumberFormat('en-US').format(x);
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `قبل ${n(mins)} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `قبل ${n(hrs)} ساعة`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'أمس';
  if (days < 7) return `قبل ${n(days)} أيام`;
  return fmtDate(d);
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

// الحالات التي تعني أن العمل انتهى فعلياً — الحالة هي مصدر الحقيقة لاكتمال التقدّم
export const DONE_STATUSES = ['delivered', 'completed'];
// المشاريع التي ما زال تسليمها معلّقاً (تظهر في «التسليمات القادمة» وتُعدّ نشطة)
export const OPEN_DELIVERY_STATUSES = ['quote', 'preparing', 'in_progress'];

function clampProgress(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

// نسبة التقدّم المعروضة: مكتمل/مُسلّم = 100% دائماً، وإلا القيمة المُدخلة يدوياً
export function displayProgress(project) {
  if (DONE_STATUSES.includes(project?.status)) return 100;
  return clampProgress(project?.progress);
}

// نسبة التقدّم التي تُحفظ عند تغيير الحالة: تُثبَّت على 100% عند الاكتمال/التسليم
export function progressForStatus(status, currentProgress) {
  if (DONE_STATUSES.includes(status)) return 100;
  return clampProgress(currentProgress);
}
export const INVOICE_STATUS = {
  draft: { label: 'مسودة', cls: 'p-wait' },
  unpaid: { label: 'غير مدفوعة', cls: 'p-quote' },
  partial: { label: 'مدفوعة جزئياً', cls: 'p-prog' },
  paid: { label: 'مدفوعة', cls: 'p-done' },
  overdue: { label: 'متأخرة', cls: 'p-cancel' },
  refunded: { label: 'مرتجعة', cls: 'p-cancel' },
};
export const SOURCE_LABEL = {
  instagram: 'انستقرام',
  tiktok: 'تيك توك',
  referral: 'توصية صديق',
  client_referral: 'عن طريق عميل',
  employee_referral: 'عن طريق موظف',
  other: 'أخرى',
};
