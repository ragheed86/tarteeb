import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// حد المحاولات لمسارات إدارة المستخدمين (CRM-AUD-06).
// العدّاد مشترك في Postgres (rate_limit_hit) فيصح بين كل نسخ السيرفر وبعد إعادة التشغيل.
// المفتاح hash لعنوان IP — لا نخزّن العنوان نفسه. على Vercel رأس x-forwarded-for
// يضبطه Vercel نفسه (يستبدل أي قيمة يرسلها العميل)، فلا يمكن تزويره من المتصفح.
// إن تعذّر الوصول لقاعدة البيانات نرجع لعدّاد محلي محدود الحجم: المسار نفسه
// يتحقق من جلسة المدير وصلاحيته، فالحد طبقة إضافية لا الحارس الوحيد.
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX = 20;
const LOCAL_FALLBACK_MAX_KEYS = 5000;
const localHits = new Map();

function localHit(key) {
  const now = Date.now();
  const windowMs = RATE_LIMIT_WINDOW_SECONDS * 1000;
  let entry = localHits.get(key);
  if (!entry || now > entry.resetAt) entry = { count: 0, resetAt: now + windowMs };
  entry.count += 1;
  localHits.delete(key); localHits.set(key, entry); // الأحدث في الآخر
  if (localHits.size > LOCAL_FALLBACK_MAX_KEYS) {
    for (const [k, v] of localHits) { if (now > v.resetAt || localHits.size > LOCAL_FALLBACK_MAX_KEYS) localHits.delete(k); else break; }
  }
  return { hits: entry.count, retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
}

async function hashKey(value) {
  const bytes = new TextEncoder().encode(`admin-api:${value}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function rateLimit(ip) {
  const key = await hashKey(ip);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceKey) {
    try {
      const res = await fetch(`${url}/rest/v1/rpc/rate_limit_hit`, {
        method: 'POST',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_key: key, p_window_seconds: RATE_LIMIT_WINDOW_SECONDS }),
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) {
        const [row] = await res.json();
        if (row) return { hits: row.hits, retryAfter: row.retry_after };
      }
    } catch { /* نرجع للعدّاد المحلي */ }
  }
  return localHit(key);
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

export async function proxy(request) {
  const { pathname } = request.nextUrl;
  // request_id لربط سجلات الخادم بطلب العميل (مهمة 15) — نقبل قيمة الوارد إن
  // أرسلها عميل داخلي (n8n، مهمة مجدولة) موثوق، وإلا نولّد واحداً جديداً.
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID();

  if (pathname.startsWith('/api/admin/')) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim()
      || request.headers.get('x-real-ip')
      || 'unknown';
    const { hits, retryAfter } = await rateLimit(ip);
    if (hits > RATE_LIMIT_MAX) {
      const res = NextResponse.json(
        { error: 'محاولات كثيرة، حاول لاحقاً' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      );
      res.headers.set('x-request-id', requestId);
      return res;
    }
    const res = NextResponse.next();
    res.headers.set('x-request-id', requestId);
    return res;
  }

  const nonce = crypto.randomUUID().replace(/-/g, '');
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  requestHeaders.set('x-request-id', requestId);
  const nextRequest = { headers: requestHeaders };

  if (PUBLIC_PATHS.has(pathname)) {
    const response = NextResponse.next({ request: nextRequest });
    response.headers.set('Content-Security-Policy', csp);
    response.headers.set('x-request-id', requestId);
    return response;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // بلا إعداد Supabase لا يمكن التحقق هنا؛ RLS يبقى الحارس الفعلي على البيانات،
  // وهذا فحص إضافي (دفاع بالعمق) وليس آخر خط دفاع — لا نمنع التطبيق من العمل.
  if (!supabaseUrl || !supabaseAnonKey) {
    const response = NextResponse.next({ request: nextRequest });
    response.headers.set('Content-Security-Policy', csp);
    response.headers.set('x-request-id', requestId);
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
    const res = NextResponse.redirect(new URL('/', request.url));
    res.headers.set('x-request-id', requestId);
    return res;
  }
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('x-request-id', requestId);
  return response;
}

export const config = {
  matcher: [
    '/api/admin/:path*',
    '/((?!_next/static|_next/image|api/|.*\\.(?:png|jpg|jpeg|svg|ico|webp|gif|woff2?|ttf|json|geojson|webmanifest|txt)$).*)',
  ],
};
