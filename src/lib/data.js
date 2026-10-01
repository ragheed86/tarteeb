// ============================================================
//  Tarteeb SaaS App · طبقة الوصول للبيانات
//  تستخدم العميل المشترك من ./supabase وتعتمد المخطط النظيف
//  (supabase/migrations/0001_init.sql)
// ============================================================
import { cachedSupabaseRead, clearSupabaseReadCache, supabase } from './supabase';
import { isSupervisorLaborRow } from './labor';
import { signStoredFile, signStoredFiles } from './storage';

const isRefundedInvoice = (invoice) => invoice?.status === 'refunded';

// ---------- لوحة التحكم ----------
// مؤشّرات لوحة التحكم لفترة محدَّدة — صفّ واحد مجمَّع في Postgres بدل 9 استعلامات
// تجلب جداول كاملة وتُجمَّع في JavaScript (تدقيق H-3).
export async function getDashboardMetrics(from, to) {
  const { data, error } = await supabase.rpc('dashboard_metrics', { p_from: from, p_to: to });
  if (error) throw error;
  return data;
}

// ---------- العملاء ----------
export async function getClients() {
  return cachedSupabaseRead('clients', async () => {
    const { data, error } = await supabase
      .from('clients')
      .select('id,code,name,phone,source,district,status,first_contact_at,notes,referred_by_client_id,referred_by_employee_id,created_at')
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
    .select('id,code,name,phone,source,district,status,first_contact_at,notes,referred_by_client_id,referred_by_employee_id,created_at')
    .single();
  if (error) throw error;
  clearSupabaseReadCache('clients');
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
    .select('id,code,name,phone,source,district,status,first_contact_at,notes,referred_by_client_id,referred_by_employee_id,created_at')
    .single();
  if (error) throw error;
  clearSupabaseReadCache('clients');
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

// ---------- المشاريع ----------
export async function getProjects() {
  return cachedSupabaseRead('projects', async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('id,client_id,title,service_type,sale_price,status,supervisor_id,start_date,due_date,progress,created_at,updated_at')
      .order('updated_at', { ascending: false });
    if (error) throw error; return data;
  });
}
export async function getProject(id) {
  const { data, error } = await supabase.from('projects').select('*').eq('id', id).single();
  if (error) throw error; return data;
}

// ---------- تكلفة المشروع (بنود + ملخص محسوب من view) ----------
export async function getProjectCosts(projectId) {
  const { data, error } = await supabase.from('project_costs')
    .select('id,kind,label,amount,qty,hours,rate,work_date,note,worker_name,product_name,supplier_id,supplier_name,sale_price,markup_percent')
    .eq('project_id', projectId);
  if (error) throw error; return data;
}
// كل بنود التكلفة لكل المشاريع دفعة واحدة — لحساب الربح الإجمالي بلوحة التحكم
export async function getAllProjectCosts() {
  const { data, error } = await supabase.from('project_costs')
    .select('project_id,amount,work_date,created_at,kind,label,note,product_name,sale_price,markup_percent');
  if (error) throw error; return data;
}
// تكاليف مفصّلة لكل المشاريع — لتقارير التصدير (تفريق الخدمة عن المنظمات/المواد)
export async function getAllProjectCostsDetailed() {
  const { data, error } = await supabase.from('project_costs')
    .select('project_id,kind,amount,sale_price,markup_percent');
  if (error) throw error; return data;
}

// ---------- تنظيف ملفات Storage (CRM-AUD-07) ----------
// حذف السجل أو تبديل ملفه يضع المسار القديم في طابور داخل نفس عملية قاعدة البيانات
// (triggers)، ثم تأخذ هذه الدالة العناصر المستحقة وتحذف ملفاتها. الملف لا يُحذف أبداً
// وهو ما زال مرتبطاً بسجل، والفشل يُعاد لاحقاً بدل أن يُبتلع بصمت.
export async function processStorageCleanup(limit = 20) {
  const { data: items, error } = await supabase.rpc('storage_cleanup_claim', { p_limit: limit });
  if (error) return { done: 0, failed: 0, error: error.message };
  let done = 0; const failures = [];
  for (const item of items || []) {
    const { error: rmErr } = await supabase.storage.from(item.bucket).remove([item.path]);
    await supabase.rpc('storage_cleanup_finish', { p_id: item.id, p_error: rmErr ? rmErr.message || 'remove failed' : null });
    if (rmErr) failures.push(rmErr.message); else done += 1;
  }
  return { done, failed: failures.length, error: failures.join('، ') };
}
// ملف رُفع ثم فشل حفظ سجله: نحاول حذفه فوراً، وإن فشل نضعه في الطابور.
async function discardUploadedFile(bucket, path) {
  if (!path) return;
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) await supabase.rpc('storage_cleanup_enqueue', { p_bucket: bucket, p_path: path });
}

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

// ---------- المستودع ----------
export async function getInventory() {
  const { data, error } = await supabase.from('inventory_items')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error; return data;
}
export async function getWarehouses() { const { data, error } = await supabase.from('warehouses').select('*'); if (error) throw error; return data; }
export async function getCategories() { const { data, error } = await supabase.from('categories').select('*'); if (error) throw error; return data; }

// المنتجات الأكثر طلباً: تُجمَّع من مواد تكاليف المشاريع (kind=materials) حسب اسم المنتج
export async function getProductDemand() {
  const { data, error } = await supabase.from('project_costs')
    .select('product_name, qty, project_id')
    .eq('kind', 'materials')
    .not('product_name', 'is', null);
  if (error) throw error;
  const map = new Map();
  for (const r of data || []) {
    const name = (r.product_name || '').trim();
    if (!name) continue;
    const cur = map.get(name) || { name, qty: 0, times: 0, projects: new Set() };
    cur.qty += Number(r.qty) || 0;
    cur.times += 1;
    if (r.project_id) cur.projects.add(r.project_id);
    map.set(name, cur);
  }
  return [...map.values()]
    .map((x) => ({ name: x.name, qty: x.qty, times: x.times, projects: x.projects.size }))
    .sort((a, b) => b.qty - a.qty || b.times - a.times);
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

// ---------- الفواتير + الشركاء ----------
export async function getInvoices() {
  return cachedSupabaseRead('invoices', async () => {
    const { data, error } = await supabase.from('invoices')
      .select('id,number,project_id,client_id,issue_at,due_at,subtotal,vat_applicable,vat_rate,vat_amount,total,status,paid_at,zatca_qr')
      .order('issue_at', { ascending: false });
    if (error) throw error; return attachInvoiceSummaries(data);
  });
}
export async function getProjectInvoices(projectId) {
  const { data, error } = await supabase.from('invoices')
    .select('id,number,project_id,client_id,issue_at,due_at,total,status,paid_at,zatca_qr')
    .eq('project_id', projectId)
    .order('issue_at', { ascending: false });
  if (error) throw error; return attachInvoiceSummaries(data);
}
export async function getInvoiceItems(invoiceId) {
  const { data, error } = await supabase.from('invoice_items').select('*').eq('invoice_id', invoiceId);
  if (error) throw error; return data;
}
// لعرض/طباعة الفاتورة — بلا سعر التكلفة الداخلي ونسبة الزيادة (internal_base_price/
// markup_percent) اللذين لا يحتاجهما إلا نموذج تحرير الفاتورة (getInvoiceItems).
export async function getInvoiceItemsForView(invoiceId) {
  const { data, error } = await supabase.from('invoice_items')
    .select('id,invoice_id,description,qty,unit_price,unit')
    .eq('invoice_id', invoiceId);
  if (error) throw error; return data;
}
async function attachInvoiceSummaries(invoices) {
  const rows = invoices || [];
  if (rows.length === 0) return rows;
  const ids = rows.map((invoice) => invoice.id).filter(Boolean);
  const { data, error } = await supabase
    .from('invoice_payment_summaries')
    .select('invoice_id,paid_amount,remaining_amount,last_payment_at,payment_count')
    .in('invoice_id', ids);
  if (error) throw error;
  const byInvoice = Object.fromEntries((data || []).map((summary) => [summary.invoice_id, summary]));
  return rows.map((invoice) => {
    if (isRefundedInvoice(invoice)) {
      return { ...invoice, paid_amount: 0, remaining_amount: 0, last_payment_at: null, payment_count: 0 };
    }
    return {
      ...invoice,
      paid_amount: Number(byInvoice[invoice.id]?.paid_amount || 0),
      remaining_amount: Number(byInvoice[invoice.id]?.remaining_amount ?? invoice.total ?? 0),
      last_payment_at: byInvoice[invoice.id]?.last_payment_at || null,
      payment_count: Number(byInvoice[invoice.id]?.payment_count || 0),
    };
  });
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
//  المشاريع · CRUD + الفريق + المهام + الوسائط
// ============================================================
const PROJECT_COLS = 'id,client_id,title,service_type,sale_price,status,supervisor_id,start_date,due_date,progress,created_at,updated_at';
export async function createProject(p) {
  const { data, error } = await supabase.from('projects').insert(p).select(PROJECT_COLS).single();
  if (error) throw error; clearSupabaseReadCache('projects'); return data;
}
export async function updateProject(id, p) {
  const { data, error } = await supabase.from('projects').update(p).eq('id', id).select(PROJECT_COLS).single();
  if (error) throw error; clearSupabaseReadCache('projects'); return data;
}
export async function removeProject(id) {
  // احتفظ بمسارات الملفات قبل أن يحذف ON DELETE CASCADE سجلاتها.
  const [{ data: media, error: mediaReadError }, { data: attachments, error: attachmentsReadError }] = await Promise.all([
    supabase.from('project_media').select('file_path').eq('project_id', id),
    supabase.from('project_cost_attachments').select('file_path').eq('project_id', id),
  ]);
  if (mediaReadError) throw mediaReadError;
  if (attachmentsReadError) throw attachmentsReadError;

  // العلاقات التابعة (الفريق، المهام، التكاليف، الوسائط والمرفقات) تُحذف
  // تلقائياً بواسطة مفاتيح ON DELETE CASCADE. الفواتير تبقى كسجل مالي
  // ويصبح project_id فيها null وفق تعريف قاعدة البيانات.
  const { data: deleted, error } = await supabase
    .from('projects')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!deleted) throw new Error('لم يتم حذف المشروع. تحقق من صلاحية الحذف ثم حاول مجدداً.');
  clearSupabaseReadCache('projects', 'invoices');

  // ملفات المشروع (الوسائط والمرفقات) دخلت طابور التنظيف ضمن نفس عملية الحذف؛
  // نحذفها الآن، وما يفشل يبقى في الطابور ويُعاد لاحقاً.
  const cleanup = await processStorageCleanup(100);
  return { cleanupWarning: cleanup.failed ? `${cleanup.failed} ملف سيُعاد حذفه لاحقاً تلقائياً` : '' };
}

// الفريق (project_team — مفتاح مركّب) — مع أسماء الموظفين
export async function getProjectTeam(projectId) {
  const { data, error } = await supabase.from('project_team')
    .select('employee_id, employees(id,name,role)').eq('project_id', projectId);
  if (error) throw error; return data;
}
export async function addProjectTeam(projectId, employeeId) {
  const { error } = await supabase.from('project_team').insert({ project_id: projectId, employee_id: employeeId });
  if (error) throw error;
}
export async function removeProjectTeam(projectId, employeeId) {
  const { error } = await supabase.from('project_team').delete().eq('project_id', projectId).eq('employee_id', employeeId);
  if (error) throw error;
}

// المهام
export async function getProjectTasks(projectId) {
  const { data, error } = await supabase.from('project_tasks')
    .select('id,project_id,title,done,sort_order').eq('project_id', projectId)
    .order('sort_order', { ascending: true });
  if (error) throw error; return data;
}
export async function createProjectTask(p) {
  const { data, error } = await supabase.from('project_tasks').insert(p).select().single();
  if (error) throw error; return data;
}
export async function updateProjectTask(id, p) {
  const { data, error } = await supabase.from('project_tasks').update(p).eq('id', id).select().single();
  if (error) throw error; return data;
}
export async function removeProjectTask(id) {
  const { error } = await supabase.from('project_tasks').delete().eq('id', id);
  if (error) throw error;
}

// الوسائط (قبل/بعد)
const PROJECT_MEDIA_BUCKET = 'project-media';

export async function getProjectMedia(projectId) {
  const { data, error } = await supabase.from('project_media')
    .select('id,project_id,kind,file_url,file_path,created_at').eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return signStoredFiles(data, PROJECT_MEDIA_BUCKET);
}
export async function createProjectMedia(p) {
  const { data, error } = await supabase.from('project_media').insert(p).select().single();
  if (error) throw error; return data;
}
export async function uploadProjectMedia(projectId, kind, file) {
  const fallbackExt = file.type?.startsWith('video/') ? 'mp4' : 'jpg';
  const ext = (file.name.split('.').pop() || fallbackExt).toLowerCase();
  const path = `${projectId}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await supabase.storage.from(PROJECT_MEDIA_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined });
  if (upErr) throw upErr;
  let row;
  try { row = await createProjectMedia({ project_id: projectId, kind, file_url: path, file_path: path }); }
  catch (e) { await discardUploadedFile(PROJECT_MEDIA_BUCKET, path); throw e; }
  return signStoredFile(row, PROJECT_MEDIA_BUCKET);
}
export async function removeProjectMedia(id) {
  // السجل أولاً؛ الملف يدخل طابور التنظيف تلقائياً ثم يُحذف
  const { error } = await supabase.from('project_media').delete().eq('id', id);
  if (error) throw error;
  await processStorageCleanup();
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

// ---------- مرفقات تكلفة المشروع (مستندات: فواتير موردين، إيصالات...) ----------
const COST_ATTACHMENTS_BUCKET = 'project-cost-attachments';

export async function getProjectCostAttachments(projectId) {
  const { data, error } = await supabase.from('project_cost_attachments')
    .select('id,project_id,file_name,file_url,file_path,file_type,file_size,note,created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return signStoredFiles(data, COST_ATTACHMENTS_BUCKET);
}

// يرفع المستند إلى الحاوية الخاصة، ثم يعيد رابطاً موقّعاً محدود الصلاحية.
export async function uploadProjectCostAttachment(projectId, file, note = '') {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  const path = `${projectId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await supabase.storage.from(COST_ATTACHMENTS_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined });
  if (upErr) throw upErr;
  const row = {
    project_id: projectId,
    file_name: file.name,
    file_url: path,
    file_path: path,
    file_type: file.type || null,
    file_size: file.size || null,
    note: note?.trim() || null,
  };
  const { data, error } = await supabase.from('project_cost_attachments').insert(row).select().single();
  if (error) { await discardUploadedFile(COST_ATTACHMENTS_BUCKET, path); throw error; }
  return signStoredFile(data, COST_ATTACHMENTS_BUCKET);
}

export async function removeProjectCostAttachment(id) {
  const { error } = await supabase.from('project_cost_attachments').delete().eq('id', id);
  if (error) throw error;
  await processStorageCleanup();
}

// تكلفة المشروع — بنود
export async function createProjectCost(p) {
  const { data, error } = await supabase.from('project_costs').insert(p)
    .select('id,kind,label,amount,qty,hours,rate,work_date,note,worker_name,product_name,supplier_id,supplier_name,sale_price,markup_percent')
    .single();
  if (error) throw error; return data;
}
export async function removeProjectCost(id) {
  const { error } = await supabase.from('project_costs').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================
//  المستودع · أصناف
// ============================================================
export async function createInventoryItem(p) {
  const { data, error } = await supabase.from('inventory_items').insert(p).select('*').single();
  if (error) throw error; return data;
}
export async function updateInventoryItem(id, p) {
  const { data, error } = await supabase.from('inventory_items').update(p).eq('id', id).select('*').single();
  if (error) throw error;
  if ('image_path' in p) processStorageCleanup().catch(() => {});
  return data;
}
export async function removeInventoryItem(id) {
  const { error } = await supabase.from('inventory_items').delete().eq('id', id);
  if (error) throw error;
  await processStorageCleanup();
}

// يرفع صورة المنتج إلى حاوية التخزين العامة ويعيد الرابط والمسار
const PRODUCT_IMAGES_BUCKET = 'product-images';
export async function uploadProductImage(file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined });
  if (upErr) throw upErr;
  const { data: pub } = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(path);
  return { url: pub.publicUrl, path };
}
// لصورة رُفعت ولم تُحفظ في سجل المنتج. استبدال صورة محفوظة يتم عبر طابور التنظيف.
export async function removeProductImage(path) {
  await discardUploadedFile(PRODUCT_IMAGES_BUCKET, path);
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

// ============================================================
//  الفواتير · CRUD + البنود
// ============================================================
const INVOICE_COLS = 'id,number,project_id,client_id,issue_at,due_at,subtotal,vat_applicable,vat_rate,vat_amount,total,zatca_uuid,zatca_qr,status,paid_at,created_at';
export async function getInvoice(id) {
  const { data, error } = await supabase.from('invoices').select('*').eq('id', id).single();
  if (error) throw error;
  const [invoice] = await attachInvoiceSummaries([data]);
  return invoice;
}
// ينشئ الفاتورة وبنودها داخل Transaction واحدة في قاعدة البيانات.
// items=[{description,qty,unit_price}]
export async function createInvoice(invoice, items) {
  const { data, error } = await supabase.rpc('create_invoice_with_items', {
    p_invoice: invoice,
    p_items: items || [],
  });
  if (error) throw error;
  clearSupabaseReadCache('invoices');
  return data;
}
export async function updateInvoice(id, p) {
  const { data, error } = await supabase.from('invoices').update(p).eq('id', id).select(INVOICE_COLS).single();
  if (error) throw error;
  clearSupabaseReadCache('invoices');
  const [invoice] = await attachInvoiceSummaries([data]);
  return invoice;
}
export async function removeInvoice(id) {
  const { error } = await supabase.from('invoices').delete().eq('id', id);
  if (error) throw error;
  clearSupabaseReadCache('invoices');
}
// تعديل الفاتورة مع استبدال بنودها. items=[{description,qty,unit_price}]
export async function updateInvoiceWithItems(id, invoice, items) {
  const { data, error } = await supabase.rpc('update_invoice_with_items', {
    p_invoice_id: id,
    p_invoice: invoice,
    p_items: items || [],
  });
  if (error) throw error;
  clearSupabaseReadCache('invoices');
  const [updated] = await attachInvoiceSummaries([data]);
  return updated;
}
export async function getInvoicePayments(invoiceId) {
  const { data, error } = await supabase.from('invoice_payments')
    .select('id,invoice_id,amount,paid_at,method,note,created_at')
    .eq('invoice_id', invoiceId)
    .order('paid_at', { ascending: false });
  if (error) throw error; return data;
}
export async function getAllInvoicePayments() {
  const { data, error } = await supabase.from('invoice_payments')
    .select('id,invoice_id,amount,paid_at,method,created_at,invoices!inner(status)')
    .neq('invoices.status', 'refunded')
    .order('paid_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(({ invoices: _invoice, ...payment }) => payment);
}
export async function getAllInvoiceItems() {
  const { data, error } = await supabase.from('invoice_items')
    .select('invoice_id,description,qty,unit_price,internal_base_price,markup_percent,invoices!inner(status,issue_at)')
    .neq('invoices.status', 'refunded');
  if (error) throw error;
  return data || [];
}
export async function createInvoicePayment(p) {
  const payload = {
    invoice_id: p.invoice_id,
    amount: Number(p.amount) || 0,
    paid_at: p.paid_at || new Date().toISOString(),
    method: p.method || 'cash',
    note: p.note?.trim() || null,
  };
  const { data, error } = await supabase.from('invoice_payments').insert(payload).select('*').single();
  if (error) throw error; clearSupabaseReadCache('invoices'); return data;
}
export async function removeInvoicePayment(id) {
  const { error } = await supabase.from('invoice_payments').delete().eq('id', id);
  if (error) throw error;
  clearSupabaseReadCache('invoices');
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
