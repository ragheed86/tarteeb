// تحويل رقم إحصائي → لون، عبر شرائح (buckets). لا علاقة له بالخريطة أو بمنطق الأعمال.
export const EMPTY_COLOR = '#E5E7EB';
export const BUCKET_COLORS = ['#17C964', '#F5A524', '#F97316', '#F31260'];
export const DEMAND_LABELS = ['منخفض', 'متوسط', 'عالي', 'مرتفع جداً'];

export const METRICS = {
  clients: { label: 'عدد العملاء', kind: 'count', get: (s) => s.clients },
  projects: { label: 'عدد المشاريع', kind: 'count', get: (s) => s.projects },
  revenue: { label: 'قيمة العقود', kind: 'money', get: (s) => s.revenue },
};

const COUNT_THRESHOLDS = [5, 15, 30];

// مقاييس العدّ: عتبات ثابتة منطقية. مقاييس المال: عتبات ديناميكية بالكمّيات (quantiles)
// لأن المدى المالي نسبيّ لتوزيع البيانات، بخلاف الأعداد ذات المعنى المطلق.
export function buildColorScale(metricKey, values) {
  const metric = METRICS[metricKey];
  if (metric.kind === 'count') return { thresholds: COUNT_THRESHOLDS };

  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (!sorted.length) return { thresholds: [0, 0, 0] };
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { thresholds: [q(0.25), q(0.5), q(0.75)] };
}

export function bucketOf(value, scale) {
  if (!value || value <= 0) return -1;
  const [t1, t2, t3] = scale.thresholds;
  if (value <= t1) return 0;
  if (value <= t2) return 1;
  if (value <= t3) return 2;
  return 3;
}

export function colorFor(value, scale) {
  const b = bucketOf(value, scale);
  return b < 0 ? EMPTY_COLOR : BUCKET_COLORS[b];
}
