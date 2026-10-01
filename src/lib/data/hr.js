// الموارد البشرية: التكلفة والعقود والأجور والرواتب
// جزء من طبقة البيانات — يُعاد تصديره من src/lib/data.js فلا تتغير الاستيرادات في الصفحات.
import { supabase } from '../supabase';

// ============================================================
//  الموارد البشرية · التكلفة والعقود والأجور
// ============================================================
// التكلفة الفعلية لكل موظف: الأجر + حصة الشركة من التأمينات + التأمين الطبي
// + الرسوم الحكومية + مخصص نهاية الخدمة + التذاكر. تُقرأ من عرض واحد حتى
// لا تتكرر المعادلة في الواجهة وتتفرّق نسخها.
export async function getEmployeeCosts() {
  const { data, error } = await supabase.from('employee_cost_current').select('*');
  if (error) throw error;
  return (data || []).map((row) => ({
    ...row,
    total_employer_cost: Number(row.gross_pay || 0) + Number(row.gosi_employer || 0)
      + Number(row.insurance_monthly || 0) + Number(row.govt_fees_monthly || 0)
      + Number(row.eos_accrual || 0) + Number(row.ticket_accrual || 0),
  }));
}

export async function getEmployeeContract(employeeId) {
  const { data, error } = await supabase.from('employment_contracts')
    .select('*, salary_components(*)')
    .eq('employee_id', employeeId).eq('is_current', true).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getEmployeeContractHistory(employeeId) {
  const { data, error } = await supabase.from('employment_contracts')
    .select('*').eq('employee_id', employeeId).order('start_date', { ascending: false });
  if (error) throw error; return data;
}

// العقد الجديد يُنهي سريان السابق: عقد جارٍ واحد لكل موظف، والتاريخ يبقى.
export async function createEmployeeContract(payload) {
  await supabase.from('employment_contracts')
    .update({ is_current: false }).eq('employee_id', payload.employee_id).eq('is_current', true);
  const { data, error } = await supabase.from('employment_contracts')
    .insert({ ...payload, is_current: true }).select('*').single();
  if (error) throw error; return data;
}

export async function updateEmployeeContract(id, payload) {
  const { data, error } = await supabase.from('employment_contracts')
    .update(payload).eq('id', id).select('*').single();
  if (error) throw error; return data;
}

export async function createSalaryComponent(payload) {
  const { data, error } = await supabase.from('salary_components').insert(payload).select('*').single();
  if (error) throw error; return data;
}
export async function updateSalaryComponent(id, payload) {
  const { data, error } = await supabase.from('salary_components').update(payload).eq('id', id).select('*').single();
  if (error) throw error; return data;
}
export async function removeSalaryComponent(id) {
  const { error } = await supabase.from('salary_components').delete().eq('id', id);
  if (error) throw error;
}

export async function getEmployeeLeaves(employeeId) {
  const { data, error } = await supabase.from('leave_records')
    .select('*').eq('employee_id', employeeId).order('from_date', { ascending: false });
  if (error) throw error; return data;
}
export async function createLeaveRecord(payload) {
  const { data, error } = await supabase.from('leave_records').insert(payload).select('*').single();
  if (error) throw error; return data;
}
export async function removeLeaveRecord(id) {
  const { error } = await supabase.from('leave_records').delete().eq('id', id);
  if (error) throw error;
}

export async function getEmployeeAdvances(employeeId) {
  const { data, error } = await supabase.from('employee_advances')
    .select('*').eq('employee_id', employeeId).order('start_month', { ascending: false });
  if (error) throw error; return data;
}
export async function createEmployeeAdvance(payload) {
  const { data, error } = await supabase.from('employee_advances').insert(payload).select('*').single();
  if (error) throw error; return data;
}
export async function updateEmployeeAdvance(id, payload) {
  const { data, error } = await supabase.from('employee_advances').update(payload).eq('id', id).select('*').single();
  if (error) throw error; return data;
}

export async function getEmployeeAllocations(employeeId, periodMonth) {
  let q = supabase.from('employee_project_allocations')
    .select('*, projects(id,title)').eq('employee_id', employeeId);
  if (periodMonth) q = q.eq('period_month', periodMonth);
  const { data, error } = await q.order('period_month', { ascending: false });
  if (error) throw error; return data;
}
export async function upsertEmployeeAllocation(payload) {
  const { data, error } = await supabase.from('employee_project_allocations')
    .upsert(payload, { onConflict: 'employee_id,project_id,period_month' }).select('*').single();
  if (error) throw error; return data;
}
export async function removeEmployeeAllocation(id) {
  const { error } = await supabase.from('employee_project_allocations').delete().eq('id', id);
  if (error) throw error;
}

// المستحق عند انتهاء الخدمة. الاستقالة لها سلّم مختلف عن إنهاء صاحب العمل.
export async function getEosEntitlement(employeeId, reason = 'employer_termination', asOf = null) {
  const { data, error } = await supabase.rpc('employee_eos_entitlement', {
    p_employee: employeeId, p_reason: reason, p_as_of: asOf,
  });
  if (error) throw error; return Number(data || 0);
}

export async function getHrSettings() {
  const { data, error } = await supabase.from('hr_settings')
    .select('*').order('key').order('effective_from', { ascending: false });
  if (error) throw error; return data;
}
// تغيّر اللائحة سطر جديد بتاريخ سريان، لا تعديل على السطر القديم،
// فتبقى المسيّرات المقفلة مفهومة بنسبها وقتها.
export async function createHrSetting(payload) {
  const { data, error } = await supabase.from('hr_settings').insert(payload).select('*').single();
  if (error) throw error; return data;
}

export async function getPayrollRuns() {
  const { data, error } = await supabase.from('payroll_runs')
    .select('*').order('period_month', { ascending: false });
  if (error) throw error; return data;
}
export async function getPayrollLines(runId) {
  const { data, error } = await supabase.from('payroll_lines')
    .select('*, employees(id,name,role,iban,national_id,nationality)').eq('run_id', runId);
  if (error) throw error; return data;
}
export async function generatePayroll(periodMonth) {
  const { data, error } = await supabase.rpc('payroll_generate', { p_month: periodMonth });
  if (error) throw error; return data;
}
export async function lockPayroll(runId) {
  const { error } = await supabase.rpc('payroll_lock', { p_run: runId });
  if (error) throw error;
}
export async function updatePayrollLine(id, payload) {
  const { data, error } = await supabase.from('payroll_lines').update(payload).eq('id', id).select('*').single();
  if (error) throw error; return data;
}
