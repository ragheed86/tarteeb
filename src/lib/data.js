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
    .select('id,kind,label,amount').eq('project_id', projectId);
  if (error) throw error; return data;
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
