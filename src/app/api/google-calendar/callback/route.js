import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { canAccess } from '@/lib/permissions';
import { getAccessForUser } from '../../_auth';
import {
  connectEmployeeCalendar, consumeOAuthState, googleCalendarReady, OAUTH_BROWSER_COOKIE,
} from '@/lib/googleCalendar';

// Google يستدعي هذا المسار عبر تحويل المتصفح — بلا Authorization header.
// الهوية تأتي من state المخزّن على السيرفر (لا من قيمة يرسلها المتصفح)، ويجب أن يطابق
// كوكي المتصفح الذي بدأ الربط. الـ state يُستهلك مرة واحدة قبل أي تبادل للتوكن (CRM-AUD-01).
// لا نسجّل code ولا tokens ولا state في أي log.
export async function GET(request) {
  const origin = request.nextUrl.origin;
  const params = request.nextUrl.searchParams;
  const code = params.get('code');
  const state = params.get('state');
  const oauthError = params.get('error');
  const browserNonce = request.cookies.get(OAUTH_BROWSER_COOKIE)?.value;

  const back = (status) => {
    const res = NextResponse.redirect(new URL(`/employees?calendar=${status}`, origin));
    res.cookies.set(OAUTH_BROWSER_COOKIE, '', { path: '/api/google-calendar', maxAge: 0 });
    return res;
  };

  if (!googleCalendarReady || !state) return back('error');
  try {
    // نستهلك الـ state حتى عند الإلغاء/الخطأ من Google، فلا يبقى صالحاً لإعادة الاستخدام.
    const grant = await consumeOAuthState({ state, browserNonce });
    if (!grant) return back('error');
    if (oauthError) return back(oauthError === 'access_denied' ? 'cancelled' : 'error');
    if (!code) return back('error');

    // الصلاحية قد تُسحب بين بدء الربط والعودة من Google — نتحقق منها من جديد.
    const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.getUserById(grant.userId);
    if (userErr || !userData?.user) return back('error');
    const access = await getAccessForUser(userData.user);
    if (!canAccess(access, 'employees')) return back('error');

    const { data: employee } = await supabaseAdmin.from('employees').select('id').eq('id', grant.employeeId).maybeSingle();
    if (!employee) return back('error');

    const redirectUri = new URL('/api/google-calendar/callback', origin).toString();
    // الربط السابق يبقى كما هو إن فشل التبادل — الكتابة تحدث فقط بعد نجاحه.
    await connectEmployeeCalendar({
      employeeId: grant.employeeId, code, redirectUri, connectedBy: grant.userId, codeVerifier: grant.codeVerifier,
    });
    return back('connected');
  } catch {
    return back('error');
  }
}
