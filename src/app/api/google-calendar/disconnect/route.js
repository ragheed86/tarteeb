import { NextResponse } from 'next/server';
import { apiError, requirePermission } from '../../_auth';
import { disconnectEmployeeCalendar } from '@/lib/googleCalendar';

export async function POST(request) {
  const session = await requirePermission(request, 'employees');
  if (session.response) return session.response;

  const { employee_id: employeeId } = await request.json().catch(() => ({}));
  if (!employeeId) return apiError('employee_id مطلوب', 400);

  try {
    const { revoked } = await disconnectEmployeeCalendar(employeeId);
    // المزامنة توقفت في الحالتين؛ revoked=false يعني أن إلغاء Google سيُعاد تلقائياً لاحقاً
    return NextResponse.json({ ok: true, revoked });
  } catch (error) {
    return apiError(error.message || 'تعذّر فصل التقويم', 500);
  }
}
