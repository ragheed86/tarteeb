import { NextResponse } from 'next/server';
import { connectEmployeeCalendar, googleCalendarReady } from '@/lib/googleCalendar';

// Google يستدعي هذا المسار مباشرة عبر تحويل المتصفح — بلا Authorization header،
// فهوية الموظف تُستمد من state (مرّرناها بها عند بناء رابط الموافقة بـ /connect).
export async function GET(request) {
  const origin = request.nextUrl.origin;
  const code = request.nextUrl.searchParams.get('code');
  const employeeId = request.nextUrl.searchParams.get('state');
  const oauthError = request.nextUrl.searchParams.get('error');

  const back = (status) => NextResponse.redirect(new URL(`/employees?calendar=${status}`, origin));

  if (!googleCalendarReady || oauthError || !code || !employeeId) return back('error');
  try {
    const redirectUri = new URL('/api/google-calendar/callback', origin).toString();
    await connectEmployeeCalendar({ employeeId, code, redirectUri });
    return back('connected');
  } catch {
    return back('error');
  }
}
