import { NextResponse } from 'next/server';
import { apiError, requirePermission } from '../../_auth';
import { buildAuthUrl, googleCalendarReady } from '@/lib/googleCalendar';

// POST بدل GET: نحتاج نتحقق من صلاحية المستخدم عبر Bearer token قبل توليد رابط الربط،
// والفرونت هو من ينقل المتصفح لرابط Google بعدها (لا يمكن إرفاق التوكن بتنقّل مباشر).
export async function POST(request) {
  if (!googleCalendarReady) return apiError('إعدادات Google Calendar غير مكتملة على السيرفر', 500);
  const session = await requirePermission(request, 'employees');
  if (session.response) return session.response;

  const { employee_id: employeeId } = await request.json().catch(() => ({}));
  if (!employeeId) return apiError('employee_id مطلوب', 400);

  const redirectUri = new URL('/api/google-calendar/callback', request.nextUrl.origin).toString();
  const url = buildAuthUrl({ employeeId, redirectUri });
  return NextResponse.json({ url });
}
