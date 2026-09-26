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

function buildCsp(nonce) {
  // React DevMode/HMR يحتاج eval() لإعادة بناء call stacks؛ لن يُستخدم أبداً في بناء
  // الإنتاج (Vercel)، لذا نسمح به محلياً فقط كي لا تظهر تحذيرات لا علاقة لها بالإنتاج.
  const scriptSrc = process.env.NODE_ENV === 'development'
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' https://unpkg.com`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://unpkg.com`;
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com https://fonts.openmaptiles.org",
    "img-src 'self' data: blob: https://*.supabase.co https://api.maptiler.com https://server.arcgisonline.com",
    "media-src 'self' blob: https://*.supabase.co",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.maptiler.com https://server.arcgisonline.com https://fonts.openmaptiles.org",
    "worker-src 'self' blob:",
    'upgrade-insecure-requests',
  ].join('; ');
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

  // nonce لكل طلب يُمرَّر عبر رأس الطلب كي يستخدمه Next.js تلقائياً على سكربتاته
  // المضمّنة (hydration)، ويُدرج في رأس CSP في الاستجابة لإغلاق باب 'unsafe-inline'.
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', buildCsp(nonce));
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
