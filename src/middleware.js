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

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // بلا إعداد Supabase لا يمكن التحقق هنا؛ RLS يبقى الحارس الفعلي على البيانات،
  // وهذا فحص إضافي (دفاع بالعمق) وليس آخر خط دفاع — لا نمنع التطبيق من العمل.
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/', request.url));
  }
  return response;
}

export const config = {
  matcher: [
    '/api/admin/:path*',
    '/((?!_next/static|_next/image|api/|.*\\.(?:png|jpg|jpeg|svg|ico|webp|gif|woff2?|ttf|json|geojson|webmanifest|txt)$).*)',
  ],
};
