// المواعيد والاجتماعات ومزامنة Google Calendar
// جزء من طبقة البيانات — يُعاد تصديره من src/lib/data.js فلا تتغير الاستيرادات في الصفحات.
import { supabase } from '../supabase';

// ============================================================
//  المواعيد/الاجتماعات · حضور متعدد + مزامنة Google Calendar
//  (المزامنة الفعلية تمر عبر /api/appointments/sync — سرّ Google لا يلمس المتصفح)
// ============================================================
const APPOINTMENT_COLS = 'id,title,description,location,starts_at,ends_at,all_day,created_by,created_at,updated_at';

export async function getAppointments() {
  const { data, error } = await supabase.from('appointments')
    .select(`${APPOINTMENT_COLS}, appointment_attendees(employee_id, employees(id,name,role))`)
    .order('starts_at', { ascending: true });
  if (error) throw error; return data;
}
export async function createAppointment(p) {
  const { data, error } = await supabase.from('appointments').insert(p).select(APPOINTMENT_COLS).single();
  if (error) throw error; return data;
}
export async function updateAppointment(id, p) {
  const { data, error } = await supabase.from('appointments').update(p).eq('id', id).select(APPOINTMENT_COLS).single();
  if (error) throw error; return data;
}
export async function removeAppointment(id) {
  const { error } = await supabase.from('appointments').delete().eq('id', id);
  if (error) throw error;
}

// يستبدل قائمة الحضور بالكامل بمقارنة الفرق (حذف من غادر + إضافة الجديد) بدل حذف/إعادة إدراج الكل
export async function setAppointmentAttendees(appointmentId, employeeIds) {
  const { data: current, error: readError } = await supabase.from('appointment_attendees')
    .select('employee_id').eq('appointment_id', appointmentId);
  if (readError) throw readError;
  const currentIds = new Set((current || []).map((r) => r.employee_id));
  const nextIds = new Set(employeeIds);
  const toRemove = [...currentIds].filter((id) => !nextIds.has(id));
  const toAdd = [...nextIds].filter((id) => !currentIds.has(id));
  if (toRemove.length) {
    const { error } = await supabase.from('appointment_attendees').delete()
      .eq('appointment_id', appointmentId).in('employee_id', toRemove);
    if (error) throw error;
  }
  if (toAdd.length) {
    const { error } = await supabase.from('appointment_attendees')
      .insert(toAdd.map((employee_id) => ({ appointment_id: appointmentId, employee_id })));
    if (error) throw error;
  }
}
