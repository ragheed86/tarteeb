// ============================================================
//  طبقة البيانات · الفواتير (بنود + دفعات + ملخصات)
//  جزء من طبقة البيانات — يُعاد تصديره من src/lib/data.js فلا تتغير
//  الاستيرادات في الصفحات.
// ============================================================
import { cachedSupabaseRead, clearSupabaseReadCache, supabase } from '../supabase';

const isRefundedInvoice = (invoice) => invoice?.status === 'refunded';

const INVOICE_COLS = 'id,number,project_id,client_id,issue_at,due_at,subtotal,vat_applicable,vat_rate,vat_amount,total,zatca_uuid,zatca_qr,status,paid_at,created_at';

export async function attachInvoiceSummaries(invoices) {
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

// ---------- الفواتير ----------
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
