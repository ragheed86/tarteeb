import { NextResponse } from 'next/server';
import { apiError, requirePermission } from '../../_auth';
import { disconnectEmployeeCalendar } from '@/lib/googleCalendar';

export async function POST(request) {
  const session = await requirePermission(request, 'employees');
  if (session.response) return session.response;

  const { employee_id: employeeId } = await request.json().catch(() => ({}));
  if (!employeeId) return apiError('employee_id مطلوب', 400);

  try {
    await disconnectEmployeeCalendar(employeeId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error.message || 'تعذّر فصل التقويم', 500);
  }
}
