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
// بنود «الجدول التقديري» (عمالة/إشراف/مواد/نقل/أخرى بلا وصف مخصّص) مقابل بنود التكلفة الحرة
// التي يضيفها المستخدم يدوياً بنوع ووصف ومبلغ من اختياره.
function isManagedCostRow(c) {
  const managedLabels = new Set(['عمالة', 'إشراف']);
  const managedKinds = new Set(['materials', 'transport', 'other']);
  return (c.kind === 'labor' && (managedLabels.has(c.label) || String(c.label || '').startsWith('عمالة:')))
    || (c.kind === 'materials' && (!c.label || String(c.label || '').startsWith('منتج:')))
    || (managedKinds.has(c.kind) && !c.label);
}
function isDailyCostRow(c) {
  return String(c.label || '').startsWith('يومي:');
}
export function splitManagedCosts(costs) {
  const managed = []; const adhoc = [];
  for (const c of costs || []) ((isManagedCostRow(c) || isDailyCostRow(c)) ? managed : adhoc).push(c);
  return { managed, adhoc };
}
// يستبدل بنود الجدول التقديري فقط دون المساس ببنود التكلفة المخصّصة التي يضيفها المستخدم يدوياً
export async function saveProjectCosts(projectId, rows, options = {}) {
  const scope = options.scope || 'estimate';
  const { data: existing, error: fetchErr } = await supabase.from('project_costs')
    .select('id,kind,label').eq('project_id', projectId);
  if (fetchErr) throw fetchErr;
  const idsToDelete = (existing || [])
    .filter((c) => {
      if (scope === 'daily') return isDailyCostRow(c) || isManagedCostRow(c);
      return isManagedCostRow(c) && !isDailyCostRow(c);
    })
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
  if (Array.isArray(estimate.dailyRows)) {
    const rows = [];
    for (const day of estimate.dailyRows) {
      for (const r of day.laborRows || []) {
        const workerCount = n(r.workerCount ?? r.count ?? r.qty ?? (r.person ? 1 : 0));
        const amount = workerCount * n(r.hours) * n(r.rate);
        const worker = String(r.worker || '').trim();
        rows.push({
          kind: 'labor',
          label: `يومي: ${day.date} · عمالة: ${workerCount || 0} عامل${worker ? ` · الموظف: ${worker}` : ''}`,
          qty: workerCount,
          hours: n(r.hours),
          rate: n(r.rate),
          amount,
        });
      }
      for (const r of day.productRows || []) {
        const supplier = r.supplierName ? ` · المورد: ${r.supplierName}` : '';
        const sale = n(r.salePrice) ? ` · البيع: ${n(r.salePrice)}` : '';
        const pct = n(r.markupPercent) ? ` · النسبة: ${n(r.markupPercent)}%` : '';
        rows.push({
          kind: 'materials',
          label: `يومي: ${day.date} · منتج: ${r.product || 'منتج'}${supplier}${sale}${pct}`,
          amount: n(r.purchasePrice),
        });
      }
      for (const r of day.transportRows || []) {
        rows.push({ kind: 'transport', label: `يومي: ${day.date} · نقل: ${r.note || 'نقل'}`, amount: n(r.amount) });
      }
      for (const r of day.otherRows || []) {
        rows.push({ kind: 'other', label: `يومي: ${day.date} · أخرى: ${r.note || 'مصروف'}`, amount: n(r.amount) });
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
    label: `عمالة: ${r.label || 'بند'}`,
    qty: n(r.count),
    hours: n(r.hours),
    rate: n(r.rate),
  })).map((r) => ({ ...r, amount: r.qty * r.hours * r.rate }));

  const productRows = (estimate.productRows || []).map((r) => {
    const supplier = r.supplierName ? ` · المورد: ${r.supplierName}` : '';
    const sale = n(r.salePrice) ? ` · البيع: ${n(r.salePrice)}` : '';
    const pct = n(r.markupPercent) ? ` · النسبة: ${n(r.markupPercent)}%` : '';
    return {
      kind: 'materials',
      label: `منتج: ${r.product || 'منتج'}${supplier}${sale}${pct}`,
      amount: n(r.purchasePrice),
    };
  });

  const rows = [
    ...laborRows,
    ...productRows,
    { kind: 'transport', label: null, qty: null, hours: null, rate: null, amount: n(estimate.transport_cost) },
    { kind: 'other', label: null, qty: null, hours: null, rate: null, amount: n(estimate.other_cost) },
  ];
  return rows.filter((r) => r.amount > 0);
}
export function costRowsToEstimate(rows) {
  const n = (v) => Number(v) || 0;
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
    if (labelText.startsWith('يومي:')) {
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
      const label = String(r.label || '').replace(/^عمالة:\s*/, '') || 'بند';
      const row = { id: r.id || `labor-${estimate.laborRows.length}`, label, count: r.qty ?? '', hours: r.hours ?? '', rate: r.rate ?? '' };
      estimate.laborRows.push(row);
      if (label.includes('مشرف') && !estimate.supervisors_count) {
        estimate.supervisors_count = r.qty ?? ''; estimate.supervisor_hours = r.hours ?? ''; estimate.supervisor_rate = r.rate ?? '';
      } else if (!estimate.workers_count) {
        estimate.workers_count = r.qty ?? ''; estimate.worker_hours = r.hours ?? ''; estimate.worker_rate = r.rate ?? '';
      }
    } else if (r.kind === 'materials') {
      const label = String(r.label || '');
      if (label.startsWith('منتج:')) {
        const parts = Object.fromEntries(label.split(' · ').map((part) => {
          const [key, ...rest] = part.split(':');
          return [key.trim(), rest.join(':').trim()];
        }));
        estimate.productRows.push({
          id: r.id || `product-${estimate.productRows.length}`,
          product: parts['منتج'] || '',
          supplierName: parts['المورد'] || '',
          purchasePrice: r.amount ?? '',
          salePrice: parts['البيع'] || '',
          markupPercent: String(parts['النسبة'] || '').replace('%', ''),
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
export async function getProjectInvoices(projectId) {
  const { data, error } = await supabase.from('invoices')
    .select('id,number,project_id,client_id,issue_at,total,status,zatca_qr')
    .eq('project_id', projectId)
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
