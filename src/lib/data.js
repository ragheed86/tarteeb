// ============================================================
//  Tarteeb SaaS App · طبقة الوصول للبيانات
//  تستخدم العميل المشترك من ./supabase وتعتمد المخطط النظيف
//  (supabase/migrations/0001_init.sql)
// ============================================================
import { cachedSupabaseRead, clearSupabaseReadCache, supabase } from './supabase';
import { isSupervisorLaborRow } from './labor';
import { signStoredFile, signStoredFiles } from './storage';

const isRefundedInvoice = (invoice) => invoice?.status === 'refunded';

// ---------- العملاء ----------
export async function getClients() {
  return cachedSupabaseRead('clients', async () => {
    const { data, error } = await supabase
      .from('clients')
      .select('id,code,name,phone,source,district,status,first_contact_at,notes,referred_by_client_id,referred_by_employee_id,created_at')
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
  if (error) throw error; return data;
}
export async function removeCompanyExpense(id) {
  const { error } = await supabase.from('company_expenses').delete().eq('id', id);
  if (error) throw error;
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
export async function removeCompanyExpenseReceipt(path) {
  if (!path) return;
  const { error } = await supabase.storage.from(COMPANY_EXPENSE_RECEIPTS_BUCKET).remove([path]);
  if (error) throw error;
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

// ---------- الحسابات والمطابقة البنكية ----------
export async function getBankAccounts() {
  const { data, error } = await supabase.from('bank_accounts').select('*').order('created_at');
  if (error) throw error; return data;
}
export async function createBankAccount(p) {
  const { data, error } = await supabase.from('bank_accounts').insert(p).select('*').single();
  if (error) throw error; return data;
}
export async function getBankTransactions(accountId) {
  let query = supabase.from('bank_transactions').select('*').order('transaction_date', { ascending: false }).order('created_at', { ascending: false });
  if (accountId) query = query.eq('account_id', accountId);
  const { data, error } = await query;
  if (error) throw error; return data;
}
export async function importBankTransactions(rows) {
  if (!rows.length) return [];
  const { data, error } = await supabase.from('bank_transactions')
    .upsert(rows, { onConflict: 'account_id,external_id', ignoreDuplicates: true }).select('*');
  if (error) throw error; return data || [];
}
export async function updateBankTransaction(id, p) {
  const { data, error } = await supabase.from('bank_transactions').update(p).eq('id', id).select('*').single();
  if (error) throw error; return data;
}
export async function getReconciliationInvoicePayments() {
  const { data, error } = await supabase.from('invoice_payments')
    .select('id,invoice_id,amount,paid_at,note,invoices!inner(number,status)')
    .neq('invoices.status', 'refunded').order('paid_at', { ascending: false });
  if (error) throw error; return data || [];
}
// بنود «الجدول التقديري» (عمالة/إشراف/مواد/نقل/أخرى بلا وصف مخصّص) مقابل بنود التكلفة الحرة
// التي يضيفها المستخدم يدوياً بنوع ووصف ومبلغ من اختياره.
// يستبدل بنود الجدول التقديري فقط دون المساس ببنود التكلفة المخصّصة التي يضيفها المستخدم يدوياً
export async function saveProjectCosts(projectId, rows, options = {}) {
  const scope = options.scope || 'estimate';
  const { data, error } = await supabase.rpc('replace_project_costs', {
    p_project_id: projectId,
    p_rows: rows || [],
    p_scope: scope,
  });
  if (error) throw error; return data;
}
// جدول تقديري (عمالة/إشراف/مواد/نقل/أخرى) <-> بنود project_costs
export function estimateToCostRows(estimate) {
  const n = (v) => Number(v) || 0;
  const clean = (v) => String(v || '').trim() || null;
  if (Array.isArray(estimate.dailyRows)) {
    const rows = [];
    for (const day of estimate.dailyRows) {
      for (const r of day.laborRows || []) {
        const workerCount = n(r.workerCount ?? r.count ?? r.qty ?? (r.person ? 1 : 0));
        const amount = workerCount * n(r.hours) * n(r.rate);
        const workerName = clean(r.worker);
        rows.push({
          kind: 'labor',
          label: null,
          work_date: day.date,
          note: isSupervisorLaborRow(r) ? `مشرف: ${workerName || 'مشرف'}` : null,
          worker_name: workerName,
          qty: workerCount,
          hours: n(r.hours),
          rate: n(r.rate),
          amount,
        });
      }
      for (const r of day.productRows || []) {
        rows.push({
          kind: 'materials',
          label: null,
          work_date: day.date,
          product_name: clean(r.product) || 'منتج',
          supplier_id: clean(r.supplierId),
          supplier_name: clean(r.supplierName),
          sale_price: n(r.salePrice) || null,
          markup_percent: n(r.markupPercent) || null,
          amount: n(r.purchasePrice),
        });
      }
      for (const r of day.transportRows || []) {
        rows.push({ kind: 'transport', label: null, work_date: day.date, note: clean(r.note) || 'نقل', amount: n(r.amount) });
      }
      for (const r of day.otherRows || []) {
        rows.push({ kind: 'other', label: null, work_date: day.date, note: clean(r.note) || 'مصروف', amount: n(r.amount) });
      }
    }
    return rows.filter((r) => r.amount > 0);
  }

  const laborSource = Array.isArray(estimate.laborRows)
    ? estimate.laborRows
    : [
      { label: 'عامل', count: estimate.workers_count, hours: estimate.worker_hours, rate: estimate.worker_rate },
      { label: 'مشرف', count: estimate.supervisors_count, hours: estimate.supervisor_hours, rate: estimate.supervisor_rate },
    ];
  const laborRows = laborSource.map((r) => ({
    kind: 'labor',
    label: null,
    note: clean(r.label) || 'بند',
    qty: n(r.count),
    hours: n(r.hours),
    rate: n(r.rate),
  })).map((r) => ({ ...r, amount: r.qty * r.hours * r.rate }));

  const productRows = (estimate.productRows || []).map((r) => ({
    kind: 'materials',
    label: null,
    product_name: clean(r.product) || 'منتج',
    supplier_id: clean(r.supplierId),
    supplier_name: clean(r.supplierName),
    sale_price: n(r.salePrice) || null,
    markup_percent: n(r.markupPercent) || null,
    amount: n(r.purchasePrice),
  }));

  const rows = [
    ...laborRows,
    ...productRows,
    { kind: 'transport', label: null, note: null, qty: null, hours: null, rate: null, amount: n(estimate.transport_cost) },
    { kind: 'other', label: null, note: null, qty: null, hours: null, rate: null, amount: n(estimate.other_cost) },
  ];
  return rows.filter((r) => r.amount > 0);
}
export function costRowsToEstimate(rows) {
  const n = (v) => Number(v) || 0;
  const legacyParts = (label) => Object.fromEntries(String(label || '').split(' · ').map((part) => {
    const [key, ...rest] = part.split(':');
    return [key.trim(), rest.join(':').trim()];
  }));
  const estimate = {
    workers_count: '', worker_hours: '', worker_rate: '',
    supervisors_count: '', supervisor_hours: '', supervisor_rate: '',
    materials_cost: '', transport_cost: '', other_cost: '',
    laborRows: [], productRows: [], dailyRows: [],
  };
  const dailyByDate = new Map();
  const ensureDay = (date) => {
    if (!dailyByDate.has(date)) {
      dailyByDate.set(date, { date, laborRows: [], productRows: [], transportRows: [], otherRows: [] });
    }
    return dailyByDate.get(date);
  };

  for (const r of rows || []) {
    const labelText = String(r.label || '');
    if (r.work_date) {
      const date = String(r.work_date).slice(0, 10);
      const day = ensureDay(date);
      if (r.kind === 'labor') {
        const hasHourlyDetails = n(r.qty) > 0 && n(r.hours) > 0 && n(r.rate) > 0;
        if (hasHourlyDetails) {
          day.laborRows.push({
            id: r.id || `labor-${day.laborRows.length}`,
            workerCount: r.qty ?? '',
            worker: r.worker_name || '',
            role: isSupervisorLaborRow(r) ? 'supervisor' : 'worker',
            hours: r.hours ?? '',
            rate: r.rate ?? '',
          });
        } else if (n(r.amount) > 0) {
          day.otherRows.push({
            id: r.id || `other-${day.otherRows.length}`,
            note: r.note || r.worker_name || 'مصروف عمالة',
            amount: r.amount ?? '',
          });
        }
      } else if (r.kind === 'materials') {
        day.productRows.push({
          id: r.id || `product-${day.productRows.length}`,
          product: r.product_name || '',
          supplierId: r.supplier_id || '',
          supplierName: r.supplier_name || '',
          purchasePrice: r.amount ?? '',
          salePrice: r.sale_price ?? '',
          markupPercent: r.markup_percent ?? '',
        });
      } else if (r.kind === 'transport') {
        day.transportRows.push({ id: r.id || `transport-${day.transportRows.length}`, note: r.note || '', amount: r.amount ?? '' });
      } else if (r.kind === 'other') {
        day.otherRows.push({ id: r.id || `other-${day.otherRows.length}`, note: r.note || '', amount: r.amount ?? '' });
      }
    } else if (labelText.startsWith('يومي:')) {
      const parts = labelText.split(' · ');
      const date = parts[0].replace('يومي:', '').trim();
      const day = ensureDay(date);
      const findPart = (prefix) => parts.find((p) => p.startsWith(prefix))?.replace(prefix, '').trim() || '';
      const dailyNote = () => parts.slice(1).join(' · ').trim() || labelText.replace(/^يومي:\s*[^·]+ ·?\s*/, '').trim();
      if (r.kind === 'labor') {
        const hasHourlyDetails = n(r.qty) > 0 && n(r.hours) > 0 && n(r.rate) > 0;
        if (hasHourlyDetails) {
          day.laborRows.push({
            id: r.id || `labor-${day.laborRows.length}`,
            workerCount: r.qty ?? (findPart('عمالة:').match(/\d+(\.\d+)?/)?.[0] || ''),
            worker: findPart('الموظف:') || '',
            role: isSupervisorLaborRow({ ...r, worker: findPart('الموظف:') || '', note: findPart('مشرف:') || r.note }) ? 'supervisor' : 'worker',
            hours: r.hours ?? '',
            rate: r.rate ?? '',
          });
        } else if (n(r.amount) > 0) {
          day.otherRows.push({
            id: r.id || `other-${day.otherRows.length}`,
            note: findPart('مشرف:') || findPart('عمالة:') || dailyNote() || 'مصروف عمالة',
            amount: r.amount ?? '',
          });
        }
      } else if (r.kind === 'materials') {
        day.productRows.push({
          id: r.id || `product-${day.productRows.length}`,
          product: findPart('منتج:') || dailyNote() || '',
          supplierName: findPart('المورد:') || '',
          purchasePrice: r.amount ?? '',
          salePrice: findPart('البيع:') || '',
          markupPercent: findPart('النسبة:').replace('%', '') || '',
        });
      } else if (r.kind === 'transport') {
        day.transportRows.push({ id: r.id || `transport-${day.transportRows.length}`, note: findPart('نقل:') || '', amount: r.amount ?? '' });
      } else if (r.kind === 'other') {
        day.otherRows.push({ id: r.id || `other-${day.otherRows.length}`, note: findPart('أخرى:') || '', amount: r.amount ?? '' });
      }
    } else if (r.kind === 'labor') {
      const label = r.note || String(r.label || '').replace(/^عمالة:\s*/, '') || 'بند';
      const row = { id: r.id || `labor-${estimate.laborRows.length}`, label, count: r.qty ?? '', hours: r.hours ?? '', rate: r.rate ?? '' };
      estimate.laborRows.push(row);
      if (label.includes('مشرف') && !estimate.supervisors_count) {
        estimate.supervisors_count = r.qty ?? ''; estimate.supervisor_hours = r.hours ?? ''; estimate.supervisor_rate = r.rate ?? '';
      } else if (!estimate.workers_count) {
        estimate.workers_count = r.qty ?? ''; estimate.worker_hours = r.hours ?? ''; estimate.worker_rate = r.rate ?? '';
      }
    } else if (r.kind === 'materials') {
      const label = String(r.label || '');
      if (r.product_name || label.startsWith('منتج:')) {
        const parts = legacyParts(label);
        estimate.productRows.push({
          id: r.id || `product-${estimate.productRows.length}`,
          product: r.product_name || parts['منتج'] || '',
          supplierId: r.supplier_id || '',
          supplierName: r.supplier_name || parts['المورد'] || '',
          purchasePrice: r.amount ?? '',
          salePrice: r.sale_price ?? parts['البيع'] ?? '',
          markupPercent: r.markup_percent ?? String(parts['النسبة'] || '').replace('%', ''),
        });
      } else {
        estimate.materials_cost = r.amount ?? '';
      }
    }
    else if (r.kind === 'transport') estimate.transport_cost = r.amount ?? '';
    else if (r.kind === 'other') estimate.other_cost = r.amount ?? '';
  }
  estimate.dailyRows = Array.from(dailyByDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  if (estimate.laborRows.length === 0 && (estimate.workers_count || estimate.supervisors_count)) {
    if (estimate.workers_count) estimate.laborRows.push({ id: 'worker', label: 'عامل', count: estimate.workers_count, hours: estimate.worker_hours, rate: estimate.worker_rate });
    if (estimate.supervisors_count) estimate.laborRows.push({ id: 'supervisor', label: 'مشرف', count: estimate.supervisors_count, hours: estimate.supervisor_hours, rate: estimate.supervisor_rate });
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

  // حذف الملفات الفعلية من Storage بعد نجاح حذف قاعدة البيانات. فشل تنظيف
  // ملف لا يعيد المشروع المحذوف، لكنه يُعاد كتحذير واضح للمستخدم.
  const cleanupErrors = [];
  const mediaPaths = (media || []).map((row) => row.file_path).filter(Boolean);
  const attachmentPaths = (attachments || []).map((row) => row.file_path).filter(Boolean);
  if (mediaPaths.length) {
    const { error: storageError } = await supabase.storage.from(PROJECT_MEDIA_BUCKET).remove(mediaPaths);
    if (storageError) cleanupErrors.push(storageError.message);
  }
  if (attachmentPaths.length) {
    const { error: storageError } = await supabase.storage.from(COST_ATTACHMENTS_BUCKET).remove(attachmentPaths);
    if (storageError) cleanupErrors.push(storageError.message);
  }

  return { cleanupWarning: cleanupErrors.length ? cleanupErrors.join('، ') : '' };
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
  const row = await createProjectMedia({ project_id: projectId, kind, file_url: path, file_path: path });
  return signStoredFile(row, PROJECT_MEDIA_BUCKET);
}
export async function removeProjectMedia(id, filePath) {
  if (filePath) await supabase.storage.from(PROJECT_MEDIA_BUCKET).remove([filePath]).catch(() => {});
  const { error } = await supabase.from('project_media').delete().eq('id', id);
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
  if (error) throw error;
  return signStoredFile(data, DASHBOARD_MEDIA_BUCKET);
}

export async function removeDashboardMedia(id, filePath) {
  if (filePath) await supabase.storage.from(DASHBOARD_MEDIA_BUCKET).remove([filePath]).catch(() => {});
  const { error } = await supabase.from('dashboard_media').delete().eq('id', id);
  if (error) throw error;
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
  if (error) throw error;
  return signStoredFile(data, COST_ATTACHMENTS_BUCKET);
}

export async function removeProjectCostAttachment(id, filePath) {
  if (filePath) await supabase.storage.from(COST_ATTACHMENTS_BUCKET).remove([filePath]).catch(() => {});
  const { error } = await supabase.from('project_cost_attachments').delete().eq('id', id);
  if (error) throw error;
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
  if (error) throw error; return data;
}
export async function removeInventoryItem(id, imagePath) {
  if (imagePath) await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([imagePath]).catch(() => {});
  const { error } = await supabase.from('inventory_items').delete().eq('id', id);
  if (error) throw error;
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
export async function removeProductImage(path) {
  if (path) await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([path]).catch(() => {});
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

// ============================================================
//  عروض الأسعار (quotes + quote_items)
//  طبقة تحويل بين شكل المولّد في الواجهة وأعمدة قاعدة البيانات:
//  بند المولّد {svc,cost,days,discount} ⟷ quote_items {description,unit_price,qty,discount}
// ============================================================
const QUOTE_COLS = 'id,number,status,client_id,client_name,issue_date,description,terms_note,validity_note,validity_days,tools_show,tools_budget_min,tools_budget_max,rejection_reason,status_history,sent_at,accepted_at,rejected_at,subtotal,discount_total,total,apply_vat,created_by,created_at,updated_at';

function mapQuoteRow(row, items) {
  return {
    id: row.id,
    number: row.number,
    status: row.status || 'draft',
    linked_client_id: row.client_id || null,
    client: row.client_name || '',
    date: row.issue_date,
    desc: row.description || '',
    note: row.terms_note || '',
    validity: row.validity_note || '',
    validityDays: row.validity_days ?? 7,
    toolsShow: row.tools_show ?? true,
    toolsMin: row.tools_budget_min ?? 0,
    toolsMax: row.tools_budget_max ?? 0,
    rejection_reason: row.rejection_reason || '',
    status_history: Array.isArray(row.status_history) ? row.status_history : [],
    sent_at: row.sent_at ? Date.parse(row.sent_at) : null,
    decided_at: (row.accepted_at || row.rejected_at) ? Date.parse(row.accepted_at || row.rejected_at) : null,
    updatedAt: row.updated_at ? Date.parse(row.updated_at) : 0,
    applyVat: !!row.apply_vat,
    items: (items || [])
      .slice()
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .map((it) => ({ svc: it.description || '', cost: Number(it.unit_price) || 0, days: Number(it.qty) || 0, discount: Number(it.discount) || 0, vatRate: it.vat_rate == null ? null : Number(it.vat_rate) })),
  };
}

// نسبة ضريبة البند: نسبة البند إن حُدّدت وإلا النسبة الافتراضية للمنشأة
function itemVatRate(it, fallback) {
  if (it.vatRate !== null && it.vatRate !== undefined && it.vatRate !== '') return Number(it.vatRate) || 0;
  const f = Number(fallback);
  return Number.isFinite(f) ? f : 15;
}

function quoteTotals(app) {
  let subtotal = 0, discount = 0, vat = 0;
  for (const it of app.items || []) {
    const line = (Number(it.cost) || 0) * (Number(it.days) || 0);
    const disc = Number(it.discount) || 0;
    subtotal += line;
    discount += disc;
    if (app.applyVat) vat += (line - disc) * itemVatRate(it, app.defaultVatRate) / 100;
  }
  return { subtotal, discount_total: discount, total: subtotal - discount + vat };
}

function fromAppQuote(app) {
  const t = quoteTotals(app);
  const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v) || 0);
  return {
    number: app.number || null,
    status: app.status || 'draft',
    client_id: app.linked_client_id || null,
    client_name: (app.client || '').trim() || null,
    issue_date: app.date || null,
    description: app.desc || null,
    terms_note: app.note || null,
    validity_note: app.validity || null,
    validity_days: Number(app.validityDays) || 7,
    tools_show: !!app.toolsShow,
    tools_budget_min: num(app.toolsMin),
    tools_budget_max: num(app.toolsMax),
    rejection_reason: app.rejection_reason || null,
    status_history: Array.isArray(app.status_history) ? app.status_history : [],
    sent_at: app.sent_at ? new Date(app.sent_at).toISOString() : null,
    accepted_at: app.status === 'accepted' ? new Date(app.decided_at || Date.now()).toISOString() : null,
    rejected_at: app.status === 'rejected' ? new Date(app.decided_at || Date.now()).toISOString() : null,
    subtotal: t.subtotal,
    discount_total: t.discount_total,
    total: t.total,
    apply_vat: !!app.applyVat,
  };
}

function itemRows(quoteId, items) {
  return (items || []).map((it, i) => ({
    quote_id: quoteId,
    description: it.svc || '',
    unit_price: Number(it.cost) || 0,
    qty: Number(it.days) || 0,
    discount: Number(it.discount) || 0,
    vat_rate: it.vatRate === null || it.vatRate === undefined || it.vatRate === '' ? null : Number(it.vatRate) || 0,
    sort_order: i,
  }));
}

export async function getQuotes() {
  return cachedSupabaseRead('quotes', async () => {
    const { data: quotes, error } = await supabase.from('quotes').select(QUOTE_COLS).order('updated_at', { ascending: false });
    if (error) throw error;
    if (!quotes.length) return [];
    const { data: items, error: e2 } = await supabase.from('quote_items').select('*').in('quote_id', quotes.map((q) => q.id));
    if (e2) throw e2;
    const byQuote = {};
    for (const it of items || []) (byQuote[it.quote_id] = byQuote[it.quote_id] || []).push(it);
    return quotes.map((q) => mapQuoteRow(q, byQuote[q.id] || []));
  });
}

export async function getQuote(id) {
  const { data: row, error } = await supabase.from('quotes').select(QUOTE_COLS).eq('id', id).single();
  if (error) throw error;
  const { data: items, error: e2 } = await supabase.from('quote_items').select('*').eq('quote_id', id);
  if (e2) throw e2;
  return mapQuoteRow(row, items || []);
}

export async function createQuote(app) {
  const { data: row, error } = await supabase.from('quotes').insert(fromAppQuote(app)).select('id').single();
  if (error) throw error;
  const rows = itemRows(row.id, app.items);
  if (rows.length) {
    const { error: e2 } = await supabase.from('quote_items').insert(rows);
    if (e2) { await supabase.from('quotes').delete().eq('id', row.id); throw e2; }
  }
  clearSupabaseReadCache('quotes');
  return getQuote(row.id);
}

export async function updateQuote(id, app) {
  const { error } = await supabase.from('quotes').update(fromAppQuote(app)).eq('id', id);
  if (error) throw error;
  await supabase.from('quote_items').delete().eq('quote_id', id);
  const rows = itemRows(id, app.items);
  if (rows.length) {
    const { error: e2 } = await supabase.from('quote_items').insert(rows);
    if (e2) throw e2;
  }
  clearSupabaseReadCache('quotes');
  return getQuote(id);
}

export async function removeQuote(id) {
  await supabase.from('quote_items').delete().eq('quote_id', id);
  const { error } = await supabase.from('quotes').delete().eq('id', id);
  if (error) throw error;
  clearSupabaseReadCache('quotes');
}

// ترقيم تلقائي Q-YYYY-NNN اعتماداً على أكبر رقم في السنة الحالية
export async function nextQuoteNumber() {
  const yr = new Date().getFullYear();
  const { data, error } = await supabase.from('quotes').select('number').ilike('number', `Q-${yr}-%`);
  if (error) throw error;
  const max = (data || []).reduce((m, r) => { const mm = (r.number || '').match(/-(\d+)$/); return mm ? Math.max(m, parseInt(mm[1], 10)) : m; }, 0);
  return `Q-${yr}-${String(max + 1).padStart(3, '0')}`;
}
