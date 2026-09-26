import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

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

// مسارات تُعرض قبل حسم المصادقة أو لا تحتاجها: الجذر (يعرض تسجيل الدخول أو
// اللوحة حسب الجلسة) ونموذج استعادة كلمة المرور (جلسته المؤقتة تُبنى من hash
// في المتصفّح بعد وصول الصفحة، فلا كوكي بعد عند أول طلب).
const PUBLIC_PATHS = new Set(['/', '/reset-password']);

// تدقيق M-4: nonce لكل طلب بدل 'unsafe-inline'. Next.js يُضمّن هذا الـnonce
// تلقائياً في سكربتاته الداخلية (hydration/RSC) فقط إذا قرأ أحد الـServer
// Components رأس x-nonce عبر headers() أثناء العرض — لذا لا يكفي ضبطه هنا،
// layout.js يجب أن يقرأه فعلياً (انظر src/app/layout.js).
// 'strict-dynamic' يجعل المتصفحات الحديثة تثق بالسكربتات التي يحمّلها سكربت
// موقّع بالـnonce (كسكربتات Next نفسها) بينما يبقى https://unpkg.com كبديل
// للمتصفحات الأقدم التي لا تدعم strict-dynamic.
function buildCsp(nonce) {
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

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/admin/')) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim()
      || request.headers.get('x-real-ip')
      || 'unknown';
    if (isRateLimited(ip)) {
      return NextResponse.json({ error: 'محاولات كثيرة، حاول لاحقاً' }, { status: 429 });
    }
    return NextResponse.next();
  }

  const nonce = crypto.randomUUID().replace(/-/g, '');
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const nextRequest = { headers: requestHeaders };

  if (PUBLIC_PATHS.has(pathname)) {
    const response = NextResponse.next({ request: nextRequest });
    response.headers.set('Content-Security-Policy', csp);
    return response;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // بلا إعداد Supabase لا يمكن التحقق هنا؛ RLS يبقى الحارس الفعلي على البيانات،
  // وهذا فحص إضافي (دفاع بالعمق) وليس آخر خط دفاع — لا نمنع التطبيق من العمل.
  if (!supabaseUrl || !supabaseAnonKey) {
    const response = NextResponse.next({ request: nextRequest });
    response.headers.set('Content-Security-Policy', csp);
    return response;
  }

  let response = NextResponse.next({ request: nextRequest });
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: nextRequest });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/', request.url));
  }
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    '/api/admin/:path*',
    '/((?!_next/static|_next/image|api/|.*\\.(?:png|jpg|jpeg|svg|ico|webp|gif|woff2?|ttf|json|geojson|webmanifest|txt)$).*)',
  ],
};
