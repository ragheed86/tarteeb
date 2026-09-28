import { NextResponse } from 'next/server';
import { apiError, requirePermission } from '../../_auth';
import { syncAppointment, deleteAppointmentSync } from '@/lib/googleCalendar';

// يُستدعى من الفرونت بعد إنشاء/تعديل/حذف موعد بترتيب — يدفع/يحدّث/يحذف حدث Google
// لكل حاضر متصل بتقويمه. فشل موظف واحد لا يوقف مزامنة الباقين (شوف src/lib/googleCalendar.js).
export async function POST(request) {
  const session = await requirePermission(request, 'appointments');
  if (session.response) return session.response;

  const { appointment_id: appointmentId, deleted } = await request.json().catch(() => ({}));
  if (!appointmentId) return apiError('appointment_id مطلوب', 400);

  try {
    if (deleted) {
      await deleteAppointmentSync(appointmentId);
      return NextResponse.json({ ok: true });
    }
    const results = await syncAppointment(appointmentId);
    return NextResponse.json({ ok: true, results });
  } catch (error) {
    return apiError(error.message || 'تعذّر مزامنة الموعد مع Google Calendar', 500);
  }
}
