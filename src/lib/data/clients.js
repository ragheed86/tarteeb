// ============================================================
//  طبقة البيانات · العملاء
//  جزء من طبقة البيانات — يُعاد تصديره من src/lib/data.js فلا تتغير
//  الاستيرادات في الصفحات.
// ============================================================
import { cachedSupabaseRead, clearSupabaseReadCache, supabase } from '../supabase';
import { attachInvoiceSummaries } from './invoices';
import { triggerAlostazSync } from './alostazSync';

function syncClientToAlostaz(clientId) {
  return triggerAlostazSync('/api/integrations/alostaz/sync-client', { client_id: clientId });
}

export async function getClients() {
  return cachedSupabaseRead('clients', async () => {
    const { data, error } = await supabase
      .from('clients')
      .select('id,code,name,phone,source,district,status,first_contact_at,notes,referred_by_client_id,referred_by_employee_id,created_at,alostaz_partner_id,alostaz_sync_error')
      .eq('in_crm', true) // جهات الواتساب غير المصنّفة تبقى في الصندوق فقط حتى تُضاف للـCRM يدوياً
      .order('created_at', { ascending: false });
    if (error) throw error; return data;
  });
}
export async function getClient(id) {
  const { data, error } = await supabase.from('clients').select('*').eq('id', id).single();
  if (error) throw error;
  // جلب اسم المُحيل (عميل أو موظف) إن وُجد
  const [refClient, refEmployee] = await Promise.all([
    data.referred_by_client_id
      ? supabase.from('clients').select('id,name').eq('id', data.referred_by_client_id).maybeSingle().then((r) => r.data)
      : null,
    data.referred_by_employee_id
      ? supabase.from('employees').select('id,name').eq('id', data.referred_by_employee_id).maybeSingle().then((r) => r.data)
      : null,
  ]);
  return { ...data, referred_by_client: refClient || null, referred_by_employee: refEmployee || null };
}
export async function createClient(input) {
  const payload = {
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    source: input.source || 'other',
    district: input.district?.trim() || null,
    status: input.status || 'active',
    first_contact_at: input.first_contact_at || null,
    notes: input.notes?.trim() || null,
    referred_by_client_id: input.referred_by_client_id || null,
    referred_by_employee_id: input.referred_by_employee_id || null,
  };
  const { data, error } = await supabase
    .from('clients')
    .insert(payload)
    .select('id,code,name,phone,source,district,status,first_contact_at,notes,referred_by_client_id,referred_by_employee_id,created_at,alostaz_partner_id,alostaz_sync_error')
    .single();
  if (error) throw error;
  clearSupabaseReadCache('clients');
  syncClientToAlostaz(data.id);
  return data;
}
export async function updateClient(id, input) {
  // تحديث جزئي آمن: يبني فقط الحقول الموجودة فعلياً بـinput (مثلاً تغيير الحالة وحدها من القائمة السريعة)
  const payload = {};
  if (input.name !== undefined) payload.name = input.name.trim();
  if (input.phone !== undefined) payload.phone = input.phone?.trim() || null;
  if (input.source !== undefined) payload.source = input.source || 'other';
  if (input.district !== undefined) payload.district = input.district?.trim() || null;
  if (input.status !== undefined) payload.status = input.status || 'active';
  if (input.first_contact_at !== undefined) payload.first_contact_at = input.first_contact_at || null;
  if (input.notes !== undefined) payload.notes = input.notes?.trim() || null;
  if (input.referred_by_client_id !== undefined) payload.referred_by_client_id = input.referred_by_client_id || null;
  if (input.referred_by_employee_id !== undefined) payload.referred_by_employee_id = input.referred_by_employee_id || null;
  const { data, error } = await supabase
    .from('clients')
    .update(payload)
    .eq('id', id)
    .select('id,code,name,phone,source,district,status,first_contact_at,notes,referred_by_client_id,referred_by_employee_id,created_at,alostaz_partner_id,alostaz_sync_error')
    .single();
  if (error) throw error;
  clearSupabaseReadCache('clients');
  if (input.name !== undefined || input.phone !== undefined || input.notes !== undefined) {
    syncClientToAlostaz(data.id); // لا داعٍ لإزعاج alostaz.io عند تغيير الحالة فقط من القائمة السريعة
  }
  return data;
}
export async function removeClient(id) {
  const { error } = await supabase.from('clients').delete().eq('id', id);
  if (error) throw error;
  clearSupabaseReadCache('clients', 'projects', 'invoices');
}
// مشاريع وفواتير عميل بعينه — لملف العميل 360
export async function getProjectsByClient(clientId) {
  const { data, error } = await supabase.from('projects')
    .select('id,title,service_type,sale_price,status,due_date,progress,created_at')
    .eq('client_id', clientId).order('created_at', { ascending: false });
  if (error) throw error; return data;
}
export async function getInvoicesByClient(clientId) {
  const { data, error } = await supabase.from('invoices')
    .select('id,number,issue_at,due_at,total,status,paid_at')
    .eq('client_id', clientId).order('issue_at', { ascending: false });
  if (error) throw error; return attachInvoiceSummaries(data);
}
