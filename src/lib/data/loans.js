// القروض والالتزامات المالية
// جزء من طبقة البيانات — يُعاد تصديره من src/lib/data.js فلا تتغير الاستيرادات في الصفحات.
import { supabase } from '../supabase';
import { isSupervisorLaborRow } from '../labor';

// ---------- القروض والالتزامات المالية ----------
export async function getLoans() {
  const { data, error } = await supabase.from('loans')
    .select('*').order('status').order('start_date', { ascending: false });
  if (error) throw error; return data || [];
}
export async function createLoan(p) {
  const { data, error } = await supabase.from('loans').insert(p).select('*').single();
  if (error) throw error; return data;
}
export async function updateLoan(id, p) {
  const { data, error } = await supabase.from('loans').update(p).eq('id', id).select('*').single();
  if (error) throw error; return data;
}
export async function removeLoan(id) {
  const { error } = await supabase.from('loans').delete().eq('id', id);
  if (error) throw error;
}
export async function getLoanInstallments(loanId) {
  let query = supabase.from('loan_installments').select('*').order('due_date').order('seq');
  if (loanId) query = query.eq('loan_id', loanId);
  const { data, error } = await query;
  if (error) throw error; return data || [];
}
// يستبدل جدول الأقساط بالكامل — يُستخدم عند إنشاء القرض أو إعادة جدولته.
export async function replaceLoanInstallments(loanId, rows) {
  const { error: delError } = await supabase.from('loan_installments').delete().eq('loan_id', loanId);
  if (delError) throw delError;
  if (!rows.length) return [];
  const { data, error } = await supabase.from('loan_installments')
    .insert(rows.map((r) => ({ ...r, loan_id: loanId }))).select('*');
  if (error) throw error; return data || [];
}
export async function updateLoanInstallment(id, p) {
  const { data, error } = await supabase.from('loan_installments').update(p).eq('id', id).select('*').single();
  if (error) throw error; return data;
}
export async function getLoanPayments(loanId) {
  let query = supabase.from('loan_payments').select('*').order('paid_at', { ascending: false }).order('created_at', { ascending: false });
  if (loanId) query = query.eq('loan_id', loanId);
  const { data, error } = await query;
  if (error) throw error; return data || [];
}
export async function createLoanPayment(p) {
  const { data, error } = await supabase.from('loan_payments').insert(p).select('*').single();
  if (error) throw error; return data;
}
export async function removeLoanPayment(id) {
  const { error } = await supabase.from('loan_payments').delete().eq('id', id);
  if (error) throw error;
}
// دفعات القروض المرتبطة بحركات بنكية — لمنع ازدواجية المطابقة البنكية.
export async function getLoanPaymentsForReconciliation() {
  const { data, error } = await supabase.from('loan_payments')
    .select('id,loan_id,amount,paid_at,reference,loans!inner(name,lender)')
    .order('paid_at', { ascending: false });
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
// جدول تقديري يومي (عمالة/مواد/نقل/أخرى) <-> بنود project_costs المُهيكَلة
// (work_date/qty/hours/rate/worker_name/product_name — migration 0006).
// أُزيل تحليل نصوص label القديم (تدقيق M-5): كل صفوف project_costs الحيّة
// تحمل work_date اليوم، ولا مستدعٍ آخر لهاتين الدالتين يقرأ الحقول المسطّحة.
export function estimateToCostRows({ dailyRows }) {
  const n = (v) => Number(v) || 0;
  const clean = (v) => String(v || '').trim() || null;
  const rows = [];
  for (const day of dailyRows || []) {
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
export function costRowsToEstimate(rows) {
  const n = (v) => Number(v) || 0;
  const dailyByDate = new Map();
  const ensureDay = (date) => {
    if (!dailyByDate.has(date)) {
      dailyByDate.set(date, { date, laborRows: [], productRows: [], transportRows: [], otherRows: [] });
    }
    return dailyByDate.get(date);
  };

  for (const r of rows || []) {
    if (!r.work_date) continue;
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
  }
  return { dailyRows: Array.from(dailyByDate.values()).sort((a, b) => a.date.localeCompare(b.date)) };
}
export async function getProjectFinancials(projectId) {
  const { data, error } = await supabase.from('project_financials')
    .select('*').eq('project_id', projectId).single();
  if (error) throw error; return data; // { sale_price, total_cost, net_profit, margin_pct }
}
