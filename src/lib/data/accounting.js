// جزء من طبقة البيانات — يُعاد تصديره من src/lib/data.js فلا تتغير الاستيرادات في الصفحات
import { supabase } from '../supabase';

export async function getChartOfAccounts() {
  const { data, error } = await supabase
    .from('chart_of_accounts')
    .select('*')
    .order('code');
  if (error) throw error;
  return data || [];
}

export async function createAccount(payload) {
  const { data, error } = await supabase
    .from('chart_of_accounts')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function updateAccount(id, payload) {
  const { data, error } = await supabase
    .from('chart_of_accounts')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function getJournalEntries({ from, to } = {}) {
  let query = supabase.from('journal_entries').select('*').order('entry_date', { ascending: false }).order('entry_no', { ascending: false });
  if (from) query = query.gte('entry_date', from);
  if (to) query = query.lte('entry_date', to);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getJournalEntryLines(entryId) {
  const { data, error } = await supabase
    .from('journal_entry_lines')
    .select('*, chart_of_accounts(code, name_ar, name_en)')
    .eq('entry_id', entryId);
  if (error) throw error;
  return data || [];
}

export async function createManualJournalEntry({ entry_date, description, lines }) {
  const { data, error } = await supabase.rpc('accounting_create_manual_entry', {
    p_entry_date: entry_date,
    p_description: description,
    p_lines: lines,
  });
  if (error) throw error;
  return data;
}

export async function reverseJournalEntry(entryId) {
  const { data, error } = await supabase.rpc('accounting_reverse_entry', { p_entry_id: entryId });
  if (error) throw error;
  return data;
}

export async function getTrialBalance(asOf) {
  const { data, error } = await supabase.rpc('accounting_trial_balance', { p_as_of: asOf });
  if (error) throw error;
  return data || [];
}

export async function getLedger(accountId, from, to) {
  const { data, error } = await supabase.rpc('accounting_ledger', {
    p_account_id: accountId, p_from: from, p_to: to,
  });
  if (error) throw error;
  return data || [];
}

export async function getIncomeStatement(from, to) {
  const { data, error } = await supabase.rpc('accounting_income_statement', { p_from: from, p_to: to });
  if (error) throw error;
  return data || [];
}

export async function getBalanceSheet(asOf) {
  const { data, error } = await supabase.rpc('accounting_balance_sheet', { p_as_of: asOf });
  if (error) throw error;
  return data || [];
}
