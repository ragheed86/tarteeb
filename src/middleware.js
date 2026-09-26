import { NextResponse } from 'next/server';

// حدّ معدّل بسيط في الذاكرة لمسارات إدارة المستخدمين (إنشاء/حذف/كلمات مرور).
// كافٍ لتطبيق داخلي بمنطقة واحدة على Vercel؛ استبدلوه بـUpstash Redis لو انتقلتم لعدة مناطق.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const rateLimitHits = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitHits.get(ip) ?? { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }
  entry.count += 1;
  rateLimitHits.set(ip, entry);
  return entry.count > RATE_LIMIT_MAX;
}

export function middleware(request) {
  if (request.nextUrl.pathname.startsWith('/api/admin/')) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim()
      || request.headers.get('x-real-ip')
      || 'unknown';
    if (isRateLimited(ip)) {
      return NextResponse.json({ error: 'محاولات كثيرة، حاول لاحقاً' }, { status: 429 });
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/admin/:path*'],
};
