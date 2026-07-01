// ============================================================
//  Tarteeb SaaS App · طبقة الوصول للبيانات
//  تستخدم العميل المشترك من ./supabase وتعتمد المخطط النظيف
//  (supabase/migrations/0001_init.sql)
// ============================================================
import { supabase } from './supabase';

// ---------- العملاء ----------
export async function getClients() {
  const { data, error } = await supabase
    .from('clients')
    .select('id,code,name,phone,source,district,status,first_contact_at,notes,created_at')
    .order('created_at', { ascending: false });
  if (error) throw error; return data;
}
export async function getClient(id) {
  const { data, error } = await supabase.from('clients').select('*').eq('id', id).single();
  if (error) throw error; return data;
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
  };
  const { data, error } = await supabase
    .from('clients')
    .insert(payload)
    .select('id,code,name,phone,source,district,status,first_contact_at,notes,created_at')
    .single();
  if (error) throw error; return data;
}
export async function updateClient(id, input) {
  const payload = {
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    source: input.source || 'other',
    district: input.district?.trim() || null,
    status: input.status || 'active',
    first_contact_at: input.first_contact_at || null,
    notes: input.notes?.trim() || null,
  };
  const { data, error } = await supabase
    .from('clients')
    .update(payload)
    .eq('id', id)
    .select('id,code,name,phone,source,district,status,first_contact_at,notes,created_at')
    .single();
  if (error) throw error; return data;
}
export async function removeClient(id) {
  const { error } = await supabase.from('clients').delete().eq('id', id);
  if (error) throw error;
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
    .select('id,number,issue_at,total,status')
    .eq('client_id', clientId).order('issue_at', { ascending: false });
  if (error) throw error; return data;
}

// ---------- المشاريع ----------
export async function getProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('id,client_id,title,service_type,sale_price,status,supervisor_id,start_date,due_date,progress,created_at')
    .order('created_at', { ascending: false });
  if (error) throw error; return data;
}
export async function getProject(id) {
  const { data, error } = await supabase.from('projects').select('*').eq('id', id).single();
  if (error) throw error; return data;
}

// ---------- تكلفة المشروع (بنود + ملخص محسوب من view) ----------
export async function getProjectCosts(projectId) {
  const { data, error } = await supabase.from('project_costs')
    .select('id,kind,label,amount,qty,hours,rate').eq('project_id', projectId);
  if (error) throw error; return data;
}
// كل بنود التكلفة لكل المشاريع دفعة واحدة — لحساب الربح الإجمالي بلوحة التحكم
export async function getAllProjectCosts() {
  const { data, error } = await supabase.from('project_costs').select('project_id,amount');
  if (error) throw error; return data;
}
// يستبدل بنود الجدول التقديري فقط (عمالة/إشراف/مواد/نقل/أخرى) دون المساس ببنود التكلفة المخصّصة التي يضيفها المستخدم يدوياً
export async function saveProjectCosts(projectId, rows) {
  const managedLabels = new Set(['عمالة', 'إشراف']);
  const managedKinds = new Set(['materials', 'transport', 'other']);
  const { data: existing, error: fetchErr } = await supabase.from('project_costs')
    .select('id,kind,label').eq('project_id', projectId);
  if (fetchErr) throw fetchErr;
  const idsToDelete = (existing || [])
    .filter((c) => (c.kind === 'labor' && managedLabels.has(c.label)) || (managedKinds.has(c.kind) && !c.label))
    .map((c) => c.id);
  if (idsToDelete.length) {
    const { error: delErr } = await supabase.from('project_costs').delete().in('id', idsToDelete);
    if (delErr) throw delErr;
  }
  if (!rows.length) return [];
  const payload = rows.map((r) => ({ ...r, project_id: projectId }));
  const { data, error } = await supabase.from('project_costs').insert(payload)
    .select('id,kind,label,amount,qty,hours,rate');
  if (error) throw error; return data;
}
// جدول تقديري (عمالة/إشراف/مواد/نقل/أخرى) <-> بنود project_costs
export function estimateToCostRows(estimate) {
  const n = (v) => Number(v) || 0;
  const rows = [
    { kind: 'labor', label: 'عمالة', qty: n(estimate.workers_count), hours: n(estimate.worker_hours), rate: n(estimate.worker_rate) },
    { kind: 'labor', label: 'إشراف', qty: n(estimate.supervisors_count), hours: n(estimate.supervisor_hours), rate: n(estimate.supervisor_rate) },
    { kind: 'materials', label: null, qty: null, hours: null, rate: null, amount: n(estimate.materials_cost) },
    { kind: 'transport', label: null, qty: null, hours: null, rate: null, amount: n(estimate.transport_cost) },
    { kind: 'other', label: null, qty: null, hours: null, rate: null, amount: n(estimate.other_cost) },
  ].map((r) => ({ ...r, amount: r.amount ?? r.qty * r.hours * r.rate }));
  return rows.filter((r) => r.amount > 0);
}
export function costRowsToEstimate(rows) {
  const estimate = {
    workers_count: '', worker_hours: '', worker_rate: '',
    supervisors_count: '', supervisor_hours: '', supervisor_rate: '',
    materials_cost: '', transport_cost: '', other_cost: '',
  };
  for (const r of rows || []) {
    if (r.kind === 'labor' && r.label === 'عمالة') {
      estimate.workers_count = r.qty ?? ''; estimate.worker_hours = r.hours ?? ''; estimate.worker_rate = r.rate ?? '';
    } else if (r.kind === 'labor' && r.label === 'إشراف') {
      estimate.supervisors_count = r.qty ?? ''; estimate.supervisor_hours = r.hours ?? ''; estimate.supervisor_rate = r.rate ?? '';
    } else if (r.kind === 'materials') estimate.materials_cost = r.amount ?? '';
    else if (r.kind === 'transport') estimate.transport_cost = r.amount ?? '';
    else if (r.kind === 'other') estimate.other_cost = r.amount ?? '';
  }
  return estimate;
}
export async function getProjectFinancials(projectId) {
  const { data, error } = await supabase.from('project_financials')
    .select('*').eq('project_id', projectId).single();
  if (error) throw error; return data; // { sale_price, total_cost, net_profit, margin_pct }
}

// ---------- المستودع ----------
export async function getInventory() {
  const { data, error } = await supabase.from('inventory_items')
    .select('id,barcode,name,category_id,unit,quantity,reorder_level,unit_cost,supplier_id,warehouse_id')
    .order('created_at', { ascending: false });
  if (error) throw error; return data;
}
export async function getWarehouses() { const { data, error } = await supabase.from('warehouses').select('*'); if (error) throw error; return data; }
export async function getCategories() { const { data, error } = await supabase.from('categories').select('*'); if (error) throw error; return data; }

// ---------- الموردون / الموظفون / الجهات / الإعدادات ----------
export async function getSuppliers()        { const { data, error } = await supabase.from('suppliers').select('*');            if (error) throw error; return data; }
export async function getEmployees()        { const { data, error } = await supabase.from('employees').select('*');            if (error) throw error; return data; }
export async function getGovernmentAccounts(){ const { data, error } = await supabase.from('government_accounts').select('*'); if (error) throw error; return data; }
export async function getCompanySettings()  { const { data, error } = await supabase.from('company_settings').select('*').limit(1).single(); if (error) throw error; return data; }

// ---------- الفواتير + الشركاء ----------
export async function getInvoices() {
  const { data, error } = await supabase.from('invoices')
    .select('id,number,project_id,client_id,issue_at,subtotal,vat_applicable,vat_rate,vat_amount,total,status,zatca_qr')
    .order('issue_at', { ascending: false });
  if (error) throw error; return data;
}
export async function getInvoiceItems(invoiceId) {
  const { data, error } = await supabase.from('invoice_items').select('*').eq('invoice_id', invoiceId);
  if (error) throw error; return data;
}
export async function getPartners() {
  const { data, error } = await supabase.from('partners').select('*');
  if (error) throw error; return data;
}

// ---------- الوارد الموحّد / 360 ----------
export async function getCommunications(clientId) {
  const q = supabase.from('communications').select('*').order('occurred_at', { ascending: false });
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
const PROJECT_COLS = 'id,client_id,title,service_type,sale_price,status,supervisor_id,start_date,due_date,progress,created_at';
export async function createProject(p) {
  const { data, error } = await supabase.from('projects').insert(p).select(PROJECT_COLS).single();
  if (error) throw error; return data;
}
export async function updateProject(id, p) {
  const { data, error } = await supabase.from('projects').update(p).eq('id', id).select(PROJECT_COLS).single();
  if (error) throw error; return data;
}
export async function removeProject(id) {
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
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
export async function getProjectMedia(projectId) {
  const { data, error } = await supabase.from('project_media')
    .select('id,project_id,kind,file_url,created_at').eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) throw error; return data;
}
export async function createProjectMedia(p) {
  const { data, error } = await supabase.from('project_media').insert(p).select().single();
  if (error) throw error; return data;
}
export async function removeProjectMedia(id) {
  const { error } = await supabase.from('project_media').delete().eq('id', id);
  if (error) throw error;
}

// تكلفة المشروع — بنود
export async function createProjectCost(p) {
  const { data, error } = await supabase.from('project_costs').insert(p).select('id,kind,label,amount').single();
  if (error) throw error; return data;
}
export async function removeProjectCost(id) {
  const { error } = await supabase.from('project_costs').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================
//  المستودع · أصناف
// ============================================================
const ITEM_COLS = 'id,barcode,name,category_id,unit,quantity,reorder_level,unit_cost,supplier_id,warehouse_id,created_at';
export async function createInventoryItem(p) {
  const { data, error } = await supabase.from('inventory_items').insert(p).select(ITEM_COLS).single();
  if (error) throw error; return data;
}
export async function updateInventoryItem(id, p) {
  const { data, error } = await supabase.from('inventory_items').update(p).eq('id', id).select(ITEM_COLS).single();
  if (error) throw error; return data;
}
export async function removeInventoryItem(id) {
  const { error } = await supabase.from('inventory_items').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================
//  الموظفون · CRUD + مستندات
// ============================================================
export async function createEmployee(p) {
  const { data, error } = await supabase.from('employees').insert(p).select('*').single();
  if (error) throw error; return data;
}
export async function updateEmployee(id, p) {
  const { data, error } = await supabase.from('employees').update(p).eq('id', id).select('*').single();
  if (error) throw error; return data;
}
export async function removeEmployee(id) {
  const { error } = await supabase.from('employees').delete().eq('id', id);
  if (error) throw error;
}
export async function getEmployeeDocuments(employeeId) {
  const { data, error } = await supabase.from('employee_documents')
    .select('id,employee_id,doc_type,file_url,expiry_date,created_at').eq('employee_id', employeeId)
    .order('expiry_date', { ascending: true });
  if (error) throw error; return data;
}
export async function getAllEmployeeDocuments() {
  const { data, error } = await supabase.from('employee_documents')
    .select('id,employee_id,doc_type,file_url,expiry_date').order('expiry_date', { ascending: true });
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
//  الشركاء · CRUD + حركات
// ============================================================
export async function createPartner(p) {
  const { data, error } = await supabase.from('partners').insert(p).select('*').single();
  if (error) throw error; return data;
}
export async function updatePartner(id, p) {
  const { data, error } = await supabase.from('partners').update(p).eq('id', id).select('*').single();
  if (error) throw error; return data;
}
export async function removePartner(id) {
  const { error } = await supabase.from('partners').delete().eq('id', id);
  if (error) throw error;
}
export async function getPartnerTransactions() {
  const { data, error } = await supabase.from('partner_transactions')
    .select('id,partner_id,period,txn_type,amount,note,created_at')
    .order('period', { ascending: false });
  if (error) throw error; return data;
}
export async function createPartnerTransaction(p) {
  const { data, error } = await supabase.from('partner_transactions').insert(p).select().single();
  if (error) throw error; return data;
}
export async function removePartnerTransaction(id) {
  const { error } = await supabase.from('partner_transactions').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================
//  الجهات الحكومية · CRUD
// ============================================================
export async function createGovernmentAccount(p) {
  const { data, error } = await supabase.from('government_accounts').insert(p).select('*').single();
  if (error) throw error; return data;
}
export async function updateGovernmentAccount(id, p) {
  const { data, error } = await supabase.from('government_accounts').update(p).eq('id', id).select('*').single();
  if (error) throw error; return data;
}
export async function removeGovernmentAccount(id) {
  const { error } = await supabase.from('government_accounts').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================
//  الفواتير · CRUD + البنود
// ============================================================
const INVOICE_COLS = 'id,number,project_id,client_id,issue_at,subtotal,vat_applicable,vat_rate,vat_amount,total,zatca_uuid,zatca_qr,status,created_at';
export async function getInvoice(id) {
  const { data, error } = await supabase.from('invoices').select('*').eq('id', id).single();
  if (error) throw error; return data;
}
// ينشئ الفاتورة ثم يدرج بنودها. items=[{description,qty,unit_price}]
export async function createInvoice(invoice, items) {
  const { data, error } = await supabase.from('invoices').insert(invoice).select(INVOICE_COLS).single();
  if (error) throw error;
  if (items && items.length) {
    const rows = items.map((it) => ({ ...it, invoice_id: data.id }));
    const { error: e2 } = await supabase.from('invoice_items').insert(rows);
    if (e2) throw e2;
  }
  return data;
}
export async function updateInvoice(id, p) {
  const { data, error } = await supabase.from('invoices').update(p).eq('id', id).select(INVOICE_COLS).single();
  if (error) throw error; return data;
}
export async function removeInvoice(id) {
  const { error } = await supabase.from('invoices').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================
//  إعدادات الشركة
// ============================================================
export async function updateCompanySettings(id, p) {
  const { data, error } = await supabase.from('company_settings').update(p).eq('id', id).select('*').single();
  if (error) throw error; return data;
}
