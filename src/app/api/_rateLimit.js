import { NextResponse } from 'next/server';

// محدِّد معدّل بسيط في الذاكرة (نافذة ثابتة). يعمل لكل نسخة خادم (per-instance)،
// فيوفّر حماية أساسية ضد الإساءة وكشط الـ API. للحماية الموزّعة على مستوى الحافة
// (DoS/brute-force على نطاق واسع) يُنصح بطبقة مثل Cloudflare أو Upstash Redis —
// موثّق في docs/SECURITY_HARDENING.md.
const buckets = new Map();

function clientKey(request, scope) {
  const fwd = request.headers.get('x-forwarded-for') || '';
  const ip = fwd.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
  return `${scope}:${ip}`;
}

// يعيد استجابة 429 عند التجاوز، أو null إذا كان الطلب ضمن الحد.
export function enforceRateLimit(request, { scope = 'default', limit = 60, windowMs = 60_000 } = {}) {
  const key = clientKey(request, scope);
  const now = Date.now();

  // تنظيف كسول للمفاتيح المنتهية كي لا تنمو الخريطة بلا حدود.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
  }

  const entry = buckets.get(key);
  if (!entry || now > entry.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return null;
  }
  entry.count += 1;
  if (entry.count > limit) {
    const retryAfter = Math.ceil((entry.reset - now) / 1000);
    return NextResponse.json(
      { error: 'تجاوزت الحد المسموح من الطلبات، حاول لاحقاً' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }
  return null;
}
