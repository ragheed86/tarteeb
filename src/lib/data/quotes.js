// عروض الأسعار: القراءة والحفظ الذري عبر save_quote_with_items
// جزء من طبقة البيانات — يُعاد تصديره من src/lib/data.js فلا تتغير الاستيرادات في الصفحات.
import { cachedSupabaseRead, clearSupabaseReadCache, supabase } from '../supabase';

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
    updatedAtRaw: row.updated_at || null,
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

// الحفظ عبر RPC واحد داخل transaction (CRM-AUD-03): الرأس والبنود ينجحان معاً أو يفشلان معاً،
// والإجماليات تُعاد حسابها على السيرفر. updatedAtRaw يمنع مسح تعديل مستخدم آخر بصمت.
export class QuoteConflictError extends Error {}
async function saveQuoteRpc(id, app) {
  const header = fromAppQuote(app);
  const { data, error } = await supabase.rpc('save_quote_with_items', {
    p_quote_id: id,
    p_quote: header,
    p_items: itemRows(null, app.items).map(({ quote_id, ...it }) => it), // eslint-disable-line no-unused-vars
    p_default_vat_rate: Number.isFinite(Number(app.defaultVatRate)) ? Number(app.defaultVatRate) : 15,
    p_expected_updated_at: id ? (app.updatedAtRaw || null) : null,
  });
  if (error) {
    if (error.code === '40001') throw new QuoteConflictError(error.message);
    throw error;
  }
  clearSupabaseReadCache('quotes');
  return getQuote(data);
}
export async function createQuote(app) { return saveQuoteRpc(null, app); }
export async function updateQuote(id, app) { return saveQuoteRpc(id, app); }

export async function removeQuote(id) {
  // البنود تُحذف تلقائياً (on delete cascade) ضمن نفس العملية
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
