import { NextResponse } from 'next/server';
import { apiError, requirePermission } from '../../_auth';
import {
  buildAuthUrl, createOAuthState, googleCalendarReady, OAUTH_BROWSER_COOKIE, OAUTH_STATE_TTL_SECONDS,
} from '@/lib/googleCalendar';

// POST بدل GET: نحتاج نتحقق من صلاحية المستخدم عبر Bearer token قبل توليد رابط الربط،
// والفرونت هو من ينقل المتصفح لرابط Google بعدها (لا يمكن إرفاق التوكن بتنقّل مباشر).
// state عشوائي لمرة واحدة ومربوط بهذا المستخدم وبكوكي httpOnly في متصفحه (CRM-AUD-01).
export async function POST(request) {
  if (!googleCalendarReady) return apiError('إعدادات Google Calendar غير مكتملة على السيرفر', 500);
  const session = await requirePermission(request, 'employees');
  if (session.response) return session.response;

  const { employee_id: employeeId } = await request.json().catch(() => ({}));
  if (!employeeId) return apiError('employee_id مطلوب', 400);

  try {
    const { state, browserNonce, codeChallenge } = await createOAuthState({ employeeId, userId: session.user.id });
    const redirectUri = new URL('/api/google-calendar/callback', request.nextUrl.origin).toString();
    const res = NextResponse.json({ url: buildAuthUrl({ state, codeChallenge, redirectUri }) });
    res.cookies.set(OAUTH_BROWSER_COOKIE, browserNonce, {
      httpOnly: true,
      secure: request.nextUrl.protocol === 'https:',
      sameSite: 'lax', // يُرسل مع تحويل Google العلوي للـ callback
      path: '/api/google-calendar',
      maxAge: OAUTH_STATE_TTL_SECONDS,
    });
    return res;
  } catch (error) {
    return apiError(error.message === 'الموظف غير موجود' ? error.message : 'تعذّر بدء الربط', error.message === 'الموظف غير موجود' ? 404 : 500);
  }
}
