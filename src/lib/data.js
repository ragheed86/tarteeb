// ============================================================
//  Tarteeb SaaS App · طبقة الوصول للبيانات
//  تستخدم العميل المشترك من ./supabase وتعتمد المخطط النظيف
//  (supabase/migrations/0001_init.sql)
// ============================================================
import { clearSupabaseReadCache, cachedSupabaseRead, supabase } from './supabase';
import { isSupervisorLaborRow } from './labor';
import { signStoredFile, signStoredFiles } from './storage';
import { discardUploadedFile, processStorageCleanup } from './data/storage';

// ---------- مصاريف الشركة العامة ----------
const COMPANY_EXPENSE_RECEIPTS_BUCKET = 'company-expense-receipts';

export async function getCompanyExpenses() {
  const { data, error } = await supabase.from('company_expenses')
    .select('*').order('expense_date', { ascending: false }).order('created_at', { ascending: false });
  if (error) throw error; return data;
}
export async function createCompanyExpense(p) {
  const { data, error } = await supabase.from('company_expenses').insert(p).select('*').single();
  if (error) throw error; return data;
}
export async function updateCompanyExpense(id, p) {
  const { data, error } = await supabase.from('company_expenses').update(p).eq('id', id).select('*').single();
  if (error) throw error;
  if ('receipt_path' in p) processStorageCleanup().catch(() => {}); // الفاتورة القديمة دخلت الطابور
  return data;
}
export async function removeCompanyExpense(id) {
  const { error } = await supabase.from('company_expenses').delete().eq('id', id);
  if (error) throw error;
  processStorageCleanup().catch(() => {});
}
export async function uploadCompanyExpenseReceipt(expenseId, file) {
  const rawExt = (file.name.split('.').pop() || (file.type === 'application/pdf' ? 'pdf' : 'jpg')).toLowerCase();
  const ext = rawExt.replace(/[^a-z0-9]/g, '') || 'bin';
  const path = `${expenseId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(COMPANY_EXPENSE_RECEIPTS_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined });
  if (error) throw error;
  return {
    receipt_path: path,
    receipt_name: file.name,
    receipt_type: file.type || null,
    receipt_size: file.size || null,
  };
}
export async function getCompanyExpenseReceiptUrl(path) {
  const { data, error } = await supabase.storage.from(COMPANY_EXPENSE_RECEIPTS_BUCKET)
    .createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}
// لملف رُفع ولم يُحفظ سجله. حذف/استبدال فاتورة محفوظة يتم تلقائياً عبر طابور التنظيف.
export async function removeCompanyExpenseReceipt(path) {
  await discardUploadedFile(COMPANY_EXPENSE_RECEIPTS_BUCKET, path);
}
export async function getCompanyExpenseBudgets() {
  const { data, error } = await supabase.from('company_expense_budgets').select('*').order('month', { ascending: false });
  if (error) throw error; return data;
}
export async function saveCompanyExpenseBudget(month, amount, alertPercent = 80) {
  const { data, error } = await supabase.from('company_expense_budgets')
    .upsert({ month, amount, alert_percent: alertPercent }, { onConflict: 'month' }).select('*').single();
  if (error) throw error; return data;
}

// ---------- الموردون / الموظفون / الجهات / الإعدادات ----------
export async function getSuppliers()        { const { data, error } = await supabase.from('suppliers').select('*');            if (error) throw error; return data; }
export async function getEmployees() {
  return cachedSupabaseRead('employees', async () => {
    const { data, error } = await supabase.from('employees').select('*');
    if (error) throw error;
    return signStoredFiles(data, 'employee-photos', 'photo_path', 'photo_url');
  });
}
// لقوائم الإسناد (اختيار موظف لمشروع/تكلفة) التي لا تحتاج إلا الاسم — بلا
// السجل الشخصي الكامل (رقم الهوية، الجنسية، الأجر...) الذي يعرضه getEmployees.
export async function getEmployeesBasic() {
  return cachedSupabaseRead('employees-basic', async () => {
    const { data, error } = await supabase.from('employees').select('id,name');
    if (error) throw error; return data;
  });
}
export async function getGovernmentAccounts() {
  const { data, error } = await supabase.from('government_accounts').select('*');
  if (error) throw error;
  return signStoredFiles(data, 'gov-documents', 'doc_path', 'doc_url');
}
export async function getCompanySettings()  { const { data, error } = await supabase.from('company_settings').select('*').limit(1).single(); if (error) throw error; return data; }

// ---------- كتالوج الخدمات ----------
export async function getServices() {
  return cachedSupabaseRead('services', async () => {
    const { data, error } = await supabase.from('services').select('*').order('sort_order').order('name');
    if (error) throw error; return data;
  });
}
export async function createService(p) {
  const { data, error } = await supabase.from('services').insert(p).select('*').single();
  if (error) throw error; clearSupabaseReadCache('services'); return data;
}
export async function updateService(id, p) {
  const { data, error } = await supabase.from('services').update({ ...p, updated_at: new Date().toISOString() }).eq('id', id).select('*').single();
  if (error) throw error; clearSupabaseReadCache('services'); return data;
}
export async function removeService(id) {
  const { error } = await supabase.from('services').delete().eq('id', id);
  if (error) throw error; clearSupabaseReadCache('services');
}

// ---------- الوارد الموحّد / 360 ----------
export async function getCommunications(clientId) {
  const q = supabase.from('communications')
    .select('id,client_id,channel,direction,body,occurred_at')
    .order('occurred_at', { ascending: false });
  const { data, error } = clientId ? await q.eq('client_id', clientId) : await q;
  if (error) throw error; return data;
}
export async function createCommunication(p) {
  const { data, error } = await supabase.from('communications').insert(p).select().single();
  if (error) throw error; return data;
}

// ============================================================
//  الموظفون · CRUD + مستندات
// ============================================================
// يرفع صورة الموظف إلى حاوية خاصة ويعيد مسارها ورابط معاينة موقّعاً.
const EMPLOYEE_PHOTOS_BUCKET = 'employee-photos';
export async function uploadEmployeePhoto(file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await supabase.storage.from(EMPLOYEE_PHOTOS_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined });
  if (upErr) throw upErr;
  const signed = await signStoredFile({ photo_path: path, photo_url: path }, EMPLOYEE_PHOTOS_BUCKET, 'photo_path', 'photo_url');
  return { path, url: signed.photo_url };
}

export async function createEmployee(p) {
  const { data, error } = await supabase.from('employees').insert(p).select('*').single();
  if (error) throw error;
  clearSupabaseReadCache('employees');
  return signStoredFile(data, EMPLOYEE_PHOTOS_BUCKET, 'photo_path', 'photo_url');
}
export async function updateEmployee(id, p) {
  const { data, error } = await supabase.from('employees').update(p).eq('id', id).select('*').single();
  if (error) throw error;
  clearSupabaseReadCache('employees');
  if ('photo_path' in p) processStorageCleanup().catch(() => {});
  return signStoredFile(data, EMPLOYEE_PHOTOS_BUCKET, 'photo_path', 'photo_url');
}
export async function removeEmployee(id) {
  const { error } = await supabase.from('employees').delete().eq('id', id);
  if (error) throw error;
  clearSupabaseReadCache('employees', 'projects');
}
export async function getEmployeeDocuments(employeeId) {
  const { data, error } = await supabase.from('employee_documents')
    .select('id,employee_id,doc_type,file_url,expiry_date,created_at').eq('employee_id', employeeId)
    .order('expiry_date', { ascending: true });
  if (error) throw error; return data;
}
export async function createEmployeeDocument(p) {
  const { data, error } = await supabase.from('employee_documents').insert(p).select().single();
  if (error) throw error; return data;
}
export async function removeEmployeeDocument(id) {
  const { error } = await supabase.from('employee_documents').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================
//  الموردون · CRUD
// ============================================================
export async function createSupplier(p) {
  const { data, error } = await supabase.from('suppliers').insert(p).select('*').single();
  if (error) throw error; return data;
}
export async function updateSupplier(id, p) {
  const { data, error } = await supabase.from('suppliers').update(p).eq('id', id).select('*').single();
  if (error) throw error; return data;
}
export async function removeSupplier(id) {
  const { error } = await supabase.from('suppliers').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================
//  الجهات الحكومية · CRUD
// ============================================================
// يرفع مستند جهة حكومية إلى حاوية خاصة ويعيد مساره ورابط معاينة موقّعاً.
const GOV_DOCUMENTS_BUCKET = 'gov-documents';
export async function uploadGovDocument(file) {
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await supabase.storage.from(GOV_DOCUMENTS_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined });
  if (upErr) throw upErr;
  const signed = await signStoredFile({ doc_path: path, doc_url: path }, GOV_DOCUMENTS_BUCKET, 'doc_path', 'doc_url');
  return { path, url: signed.doc_url };
}

export async function createGovernmentAccount(p) {
  const { data, error } = await supabase.from('government_accounts').insert(p).select('*').single();
  if (error) throw error;
  return signStoredFile(data, GOV_DOCUMENTS_BUCKET, 'doc_path', 'doc_url');
}
export async function updateGovernmentAccount(id, p) {
  const { data, error } = await supabase.from('government_accounts').update(p).eq('id', id).select('*').single();
  if (error) throw error;
  if ('doc_path' in p) processStorageCleanup().catch(() => {});
  return signStoredFile(data, GOV_DOCUMENTS_BUCKET, 'doc_path', 'doc_url');
}
export async function removeGovernmentAccount(id) {
  const { error } = await supabase.from('government_accounts').delete().eq('id', id);
  if (error) throw error;
}

// ---------- وسائط لوحة المعلومات (رفع فعلي إلى Supabase Storage) ----------
const DASHBOARD_MEDIA_BUCKET = 'dashboard-media';

export async function getDashboardMedia() {
  const { data, error } = await supabase.from('dashboard_media')
    .select('id,kind,file_url,file_path,caption,created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return signStoredFiles(data, DASHBOARD_MEDIA_BUCKET);
}

// يرفع الملف إلى الحاوية الخاصة، ثم يعيد رابطاً موقّعاً محدود الصلاحية.
export async function uploadDashboardMedia(file, caption = '') {
  const kind = file.type.startsWith('video') ? 'video' : 'image';
  const ext = (file.name.split('.').pop() || (kind === 'video' ? 'mp4' : 'jpg')).toLowerCase();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await supabase.storage.from(DASHBOARD_MEDIA_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined });
  if (upErr) throw upErr;
  const row = { kind, file_url: path, file_path: path, caption: caption?.trim() || null };
  const { data, error } = await supabase.from('dashboard_media').insert(row).select().single();
  if (error) { await discardUploadedFile(DASHBOARD_MEDIA_BUCKET, path); throw error; }
  return signStoredFile(data, DASHBOARD_MEDIA_BUCKET);
}

export async function removeDashboardMedia(id) {
  const { error } = await supabase.from('dashboard_media').delete().eq('id', id);
  if (error) throw error;
  await processStorageCleanup();
}

// ============================================================
//  إعدادات الشركة
// ============================================================
export async function updateCompanySettings(id, p) {
  const { data, error } = await supabase.from('company_settings').update(p).eq('id', id).select('*').single();
  if (error) throw error; return data;
}

// ---------- وحدات منفصلة (CRM-AUD-10) ----------
// كل مجال مستقل في ملفه؛ نعيد تصديره هنا كي تبقى استيرادات '@/lib/data' كما هي.
export * from './data/bank';
export * from './data/loans';
export * from './data/hr';
export * from './data/quotes';
export * from './data/whatsapp';
export * from './data/appointments';
// دفعة ثانية (مهمة 14 — تقسيم data.js إلى وحدات domain)
export * from './data/storage';
export * from './data/clients';
export * from './data/projects';
export * from './data/invoices';
export * from './data/inventory';
export * from './data/reports';
