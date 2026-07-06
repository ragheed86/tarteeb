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
  // تحديث جزئي آمن: يبني فقط الحقول الموجودة فعلياً بـinput (مثلاً تغيير الحالة وحدها من القائمة السريعة)
  const payload = {};
  if (input.name !== undefined) payload.name = input.name.trim();
  if (input.phone !== undefined) payload.phone = input.phone?.trim() || null;
  if (input.source !== undefined) payload.source = input.source || 'other';
  if (input.district !== undefined) payload.district = input.district?.trim() || null;
  if (input.status !== undefined) payload.status = input.status || 'active';
  if (input.first_contact_at !== undefined) payload.first_contact_at = input.first_contact_at || null;
  if (input.notes !== undefined) payload.notes = input.notes?.trim() || null;
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
    .select('id,number,issue_at,due_at,total,status,paid_at')
    .eq('client_id', clientId).order('issue_at', { ascending: false });
  if (error) throw error; return attachInvoiceSummaries(data);
}

// ---------- المشاريع ----------
export async function getProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('id,client_id,title,service_type,sale_price,status,supervisor_id,start_date,due_date,progress,created_at,updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error; return data;
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
  const { data, error } = await supabase.from('project_costs').select('project_id,amount');
  if (error) throw error; return data;
}
// بنود «الجدول التقديري» (عمالة/إشراف/مواد/نقل/أخرى بلا وصف مخصّص) مقابل بنود التكلفة الحرة
// التي يضيفها المستخدم يدوياً بنوع ووصف ومبلغ من اختياره.
function isManagedCostRow(c) {
  const managedLabels = new Set(['عمالة', 'إشراف']);
  const managedKinds = new Set(['materials', 'transport', 'other']);
  return (c.kind === 'labor' && (managedLabels.has(c.label) || String(c.label || '').startsWith('عمالة:') || c.note))
    || (c.kind === 'materials' && (!c.label || String(c.label || '').startsWith('منتج:') || c.product_name))
    || (managedKinds.has(c.kind) && !c.label);
}
function isDailyCostRow(c) {
  return Boolean(c.work_date) || String(c.label || '').startsWith('يومي:');
}
export function splitManagedCosts(costs) {
  const managed = []; const adhoc = [];
  for (const c of costs || []) ((isManagedCostRow(c) || isDailyCostRow(c)) ? managed : adhoc).push(c);
  return { managed, adhoc };
}
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
        rows.push({
          kind: 'labor',
          label: null,
          work_date: day.date,
          worker_name: clean(r.worker),
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
    .select('id,number,project_id,client_id,issue_at,due_at,subtotal,vat_applicable,vat_rate,vat_amount,total,status,paid_at,zatca_qr')
    .order('issue_at', { ascending: false });
  if (error) throw error; return attachInvoiceSummaries(data);
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
  return rows.map((invoice) => ({
    ...invoice,
    paid_amount: Number(byInvoice[invoice.id]?.paid_amount || 0),
    remaining_amount: Number(byInvoice[invoice.id]?.remaining_amount ?? invoice.total ?? 0),
    last_payment_at: byInvoice[invoice.id]?.last_payment_at || null,
    payment_count: Number(byInvoice[invoice.id]?.payment_count || 0),
  }));
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
const PROJECT_COLS = 'id,client_id,title,service_type,sale_price,status,supervisor_id,start_date,due_date,progress,created_at,updated_at';
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

// ---------- وسائط لوحة المعلومات (رفع فعلي إلى Supabase Storage) ----------
const DASHBOARD_MEDIA_BUCKET = 'dashboard-media';

export async function getDashboardMedia() {
  const { data, error } = await supabase.from('dashboard_media')
    .select('id,kind,file_url,file_path,caption,created_at')
    .order('created_at', { ascending: false });
  if (error) throw error; return data;
}

// يرفع الملف إلى الحاوية، يجلب الرابط العام، ثم يسجّل صفاً في الجدول
export async function uploadDashboardMedia(file, caption = '') {
  const kind = file.type.startsWith('video') ? 'video' : 'image';
  const ext = (file.name.split('.').pop() || (kind === 'video' ? 'mp4' : 'jpg')).toLowerCase();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await supabase.storage.from(DASHBOARD_MEDIA_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined });
  if (upErr) throw upErr;
  const { data: pub } = supabase.storage.from(DASHBOARD_MEDIA_BUCKET).getPublicUrl(path);
  const row = { kind, file_url: pub.publicUrl, file_path: path, caption: caption?.trim() || null };
  const { data, error } = await supabase.from('dashboard_media').insert(row).select().single();
  if (error) throw error; return data;
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
  if (error) throw error; return data;
}

// يرفع المستند إلى الحاوية، يجلب الرابط العام، ثم يسجّل صفاً في الجدول
export async function uploadProjectCostAttachment(projectId, file, note = '') {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  const path = `${projectId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await supabase.storage.from(COST_ATTACHMENTS_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined });
  if (upErr) throw upErr;
  const { data: pub } = supabase.storage.from(COST_ATTACHMENTS_BUCKET).getPublicUrl(path);
  const row = {
    project_id: projectId,
    file_name: file.name,
    file_url: pub.publicUrl,
    file_path: path,
    file_type: file.type || null,
    file_size: file.size || null,
    note: note?.trim() || null,
  };
  const { data, error } = await supabase.from('project_cost_attachments').insert(row).select().single();
  if (error) throw error; return data;
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
// يرفع صورة الموظف إلى حاوية التخزين العامة ويعيد الرابط العام
const EMPLOYEE_PHOTOS_BUCKET = 'employee-photos';
export async function uploadEmployeePhoto(file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await supabase.storage.from(EMPLOYEE_PHOTOS_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined });
  if (upErr) throw upErr;
  const { data: pub } = supabase.storage.from(EMPLOYEE_PHOTOS_BUCKET).getPublicUrl(path);
  return pub.publicUrl;
}

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
  return data;
}
export async function updateInvoice(id, p) {
  const { data, error } = await supabase.from('invoices').update(p).eq('id', id).select(INVOICE_COLS).single();
  if (error) throw error;
  const [invoice] = await attachInvoiceSummaries([data]);
  return invoice;
}
export async function removeInvoice(id) {
  const { error } = await supabase.from('invoices').delete().eq('id', id);
  if (error) throw error;
}
export async function getInvoicePayments(invoiceId) {
  const { data, error } = await supabase.from('invoice_payments')
    .select('id,invoice_id,amount,paid_at,method,note,created_at')
    .eq('invoice_id', invoiceId)
    .order('paid_at', { ascending: false });
  if (error) throw error; return data;
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
  if (error) throw error; return data;
}
export async function removeInvoicePayment(id) {
  const { error } = await supabase.from('invoice_payments').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================
//  إعدادات الشركة
// ============================================================
export async function updateCompanySettings(id, p) {
  const { data, error } = await supabase.from('company_settings').update(p).eq('id', id).select('*').single();
  if (error) throw error; return data;
}
