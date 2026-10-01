// الحسابات البنكية والمطابقة
// جزء من طبقة البيانات — يُعاد تصديره من src/lib/data.js فلا تتغير الاستيرادات في الصفحات.
import { supabase } from '../supabase';

// ---------- الحسابات والمطابقة البنكية ----------
export async function getBankAccounts() {
  const { data, error } = await supabase.from('bank_accounts').select('*').order('created_at');
  if (error) throw error; return data;
}
export async function createBankAccount(p) {
  const { data, error } = await supabase.from('bank_accounts').insert(p).select('*').single();
  if (error) throw error; return data;
}
const BANK_TX_SELECT = '*, bank_reconciliation_matches(*)';
export async function getBankTransactions(accountId, since) {
  let query = supabase.from('bank_transactions').select(BANK_TX_SELECT).order('transaction_date', { ascending: false }).order('created_at', { ascending: false });
  if (accountId) query = query.eq('account_id', accountId);
  if (since) query = query.gte('transaction_date', since);
  const { data, error } = await query;
  if (error) throw error; return data;
}
export async function importBankTransactions(rows) {
  if (!rows.length) return [];
  const { data, error } = await supabase.from('bank_transactions')
    .upsert(rows, { onConflict: 'account_id,external_id', ignoreDuplicates: true }).select('*');
  if (error) throw error; return data || [];
}
// الحالة (مطابق/جزئي/غير مطابق) تُشتق في قاعدة البيانات من جدول المطابقات؛ هنا فقط الاستبعاد وإلغاء علامة التكرار.
export async function updateBankTransaction(id, p) {
  const { data, error } = await supabase.from('bank_transactions').update(p).eq('id', id).select(BANK_TX_SELECT).single();
  if (error) throw error; return data;
}
// rows: [{ bank_transaction_id, expense_id | invoice_payment_id | loan_payment_id | payroll_line_id, amount, method, confidence, note }]
export async function createBankMatches(rows) {
  if (!rows.length) return [];
  const { data, error } = await supabase.from('bank_reconciliation_matches').insert(rows).select('*');
  if (error) throw error; return data || [];
}
export async function deleteBankMatch(id) {
  const { error } = await supabase.from('bank_reconciliation_matches').delete().eq('id', id);
  if (error) throw error;
}
export async function clearBankTransactionMatches(transactionId) {
  const { error } = await supabase.from('bank_reconciliation_matches').delete().eq('bank_transaction_id', transactionId);
  if (error) throw error;
}
// كل المطابقات (خفيفة) لمعرفة المتبقي من كل بند عبر جميع الحسابات
export async function getAllBankMatches() {
  const { data, error } = await supabase.from('bank_reconciliation_matches')
    .select('id,bank_transaction_id,expense_id,invoice_payment_id,loan_payment_id,payroll_line_id,amount');
  if (error) throw error; return data || [];
}
export async function getReconciliationInvoicePayments() {
  const { data, error } = await supabase.from('invoice_payments')
    .select('id,invoice_id,amount,paid_at,method,note,invoices!inner(number,status,clients(name))')
    .neq('invoices.status', 'refunded').order('paid_at', { ascending: false });
  if (error) throw error; return data || [];
}
export async function getReconciliationPayrollLines() {
  const { data, error } = await supabase.from('payroll_lines')
    .select('id,run_id,net_pay,employees(name),payroll_runs!inner(period_month,status)')
    .neq('payroll_runs.status', 'draft');
  if (error) throw error; return data || [];
}
export async function getBankPeriods(accountId) {
  const { data, error } = await supabase.from('bank_reconciliation_periods')
    .select('*').eq('account_id', accountId).order('period_month', { ascending: false });
  if (error) throw error; return data || [];
}
export async function closeBankPeriod(accountId, month, statementBalance, note) {
  const { data, error } = await supabase.rpc('bank_reconciliation_close', {
    p_account: accountId, p_month: month, p_statement_balance: statementBalance, p_note: note || null,
  });
  if (error) throw error; return data;
}
export async function reopenBankPeriod(periodId, reason) {
  const { data, error } = await supabase.rpc('bank_reconciliation_reopen', { p_period: periodId, p_reason: reason });
  if (error) throw error; return data;
}
export async function getBankAuditActors() {
  const { data, error } = await supabase.from('app_user_access').select('user_id,display_name,email');
  if (error) throw error; return data || [];
}
export async function getBankAudit(accountId, limit = 200) {
  const { data, error } = await supabase.from('bank_reconciliation_audit')
    .select('*').eq('account_id', accountId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error; return data || [];
}
