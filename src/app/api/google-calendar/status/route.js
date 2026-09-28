import { NextResponse } from 'next/server';
import { requirePermission } from '../../_auth';
import { getEmployeeCalendarConnections } from '@/lib/googleCalendar';

// employee_calendar_connections تحوي توكنات، فما فيها أي سياسة RLS لـ authenticated —
// هذا المسار وحده يكشف الأعمدة الآمنة (بريد وحالة الاتصال فقط) لواجهة الموظفين.
export async function GET(request) {
  const session = await requirePermission(request, 'employees');
  if (session.response) return session.response;
  try {
    const connections = await getEmployeeCalendarConnections();
    return NextResponse.json({ connections });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'تعذّر جلب حالة التقويم' }, { status: 500 });
  }
}
