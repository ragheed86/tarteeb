// منطق المطابقة البنكية النقي (بلا React ولا Supabase) — قابل للاختبار مستقلاً.
// الاستيراد (CSV/Excel) ← صفوف موحّدة، ثم اقتراح المطابقات بالمبلغ والتاريخ والمرجع.

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export function latinDigits(v) {
  return String(v ?? '').replace(/[٠-٩۰-۹]/g, (d) => String(AR_DIGITS.indexOf(d) >= 0 ? AR_DIGITS.indexOf(d) : FA_DIGITS.indexOf(d)));
}
export const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
export const monthOf = (date) => String(date || '').slice(0, 7);
export const monthStart = (ym) => `${ym}-01`;

function norm(s) {
  return latinDigits(s).toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[_\-./()]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------- قراءة الملفات ----------
export function parseCsvText(text) {
  const clean = String(text || '').replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/).find((l) => l.trim()) || '';
  const counts = { ',': (firstLine.match(/,/g) || []).length, ';': (firstLine.match(/;/g) || []).length, '\t': (firstLine.match(/\t/g) || []).length };
  const delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = []; let value = ''; let quoted = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { value += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else value += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(value.trim()); value = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i += 1;
      row.push(value.trim()); value = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else value += ch;
  }
  row.push(value.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

const HEADERS = {
  date: ['transaction date', 'posting date', 'value date', 'txn date', 'date', 'تاريخ العمليه', 'تاريخ الحركه', 'تاريخ القيد', 'تاريخ الاستحقاق', 'التاريخ', 'تاريخ'],
  description: ['description', 'narrative', 'details', 'particulars', 'transaction details', 'memo', 'البيان', 'الوصف', 'التفاصيل', 'بيان', 'تفاصيل العمليه', 'الشرح'],
  amount: ['amount', 'transaction amount', 'المبلغ', 'مبلغ العمليه', 'القيمه'],
  debit: ['debit', 'withdrawal', 'withdrawals', 'debit amount', 'مدين', 'سحب', 'مسحوبات', 'خصم', 'المدين'],
  credit: ['credit', 'deposit', 'deposits', 'credit amount', 'دائن', 'ايداع', 'ايداعات', 'الدائن'],
  reference: ['reference', 'ref', 'ref no', 'reference number', 'reference no', 'cheque no', 'المرجع', 'رقم المرجع', 'مرجع', 'رقم الشيك'],
  id: ['transaction id', 'transaction_id', 'id', 'رقم العمليه', 'رقم الحركه'],
  balance: ['balance', 'running balance', 'الرصيد'],
};
const TOTAL_ROW = /^(الاجمالي|اجمالي|المجموع|total|totals|grand total|opening balance|closing balance|رصيد افتتاحي|الرصيد الافتتاحي|رصيد ختامي|الرصيد الختامي)$/;
function headerIndex(headers, key) {
  const list = HEADERS[key].map(norm);
  let i = headers.findIndex((h) => list.includes(h));
  if (i < 0 && key !== 'id') i = headers.findIndex((h) => h && list.some((x) => x.length > 3 && h.includes(x)));
  return i;
}

export function normalizeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const d = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && value > 20000 && value < 80000) { // رقم تسلسلي من Excel
    return new Date(Math.round((value - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const v = latinDigits(value).trim();
  let m = v.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/); // يوم/شهر/سنة (صيغة البنوك السعودية)
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const day = Number(m[1]); const mon = Number(m[2]);
    const [dd, mm] = mon > 12 && day <= 12 ? [mon, day] : [day, mon];
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
    return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10);
}

export function parseAmount(value) {
  if (typeof value === 'number') return round2(value);
  let v = latinDigits(value).replace(/[٬،]/g, ',').replace(/٫/g, '.').replace(/[^\d.,\-()]/g, '');
  const negative = /^\(.*\)$/.test(v) || v.startsWith('-') || v.endsWith('-');
  v = v.replace(/[()\-]/g, '');
  if (v.includes(',') && v.includes('.')) v = v.lastIndexOf(',') > v.lastIndexOf('.') ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '');
  else if (v.includes(',')) v = /,\d{1,2}$/.test(v) ? v.replace(',', '.') : v.replace(/,/g, '');
  const n = Number(v) || 0;
  return round2(negative ? -n : n);
}

// يحوّل مصفوفة صفوف (من CSV أو Excel) إلى حركات؛ يتخطى أسطر العنوان التمهيدية لكشوف البنوك.
export function rowsToTransactions(table, accountId) {
  const rows = (table || []).map((r) => (r || []).map((c) => (c == null ? '' : c)));
  let headerRow = -1; let map = null;
  for (let r = 0; r < Math.min(rows.length, 25); r += 1) {
    const headers = rows[r].map((h) => (h instanceof Date ? '' : norm(h)));
    const idx = Object.fromEntries(Object.keys(HEADERS).map((k) => [k, headerIndex(headers, k)]));
    if (idx.date >= 0 && (idx.amount >= 0 || idx.debit >= 0 || idx.credit >= 0)) { headerRow = r; map = idx; break; }
  }
  if (headerRow < 0) throw new Error('لم أجد أعمدة التاريخ والمبلغ (أو مدين/دائن) في الملف');
  const out = []; const errors = []; const seen = new Map();
  rows.slice(headerRow + 1).forEach((cols, i) => {
    const line = headerRow + i + 2;
    if (!cols.some((c) => String(c).trim() !== '')) return;
    if (cols.some((c) => typeof c === 'string' && TOTAL_ROW.test(norm(c)))) return; // سطر إجمالي/رصيد
    const date = normalizeDate(cols[map.date]);
    let amount;
    if (map.amount >= 0 && String(cols[map.amount]).trim() !== '') amount = parseAmount(cols[map.amount]);
    else amount = round2(Math.abs(parseAmount(map.credit >= 0 ? cols[map.credit] : 0)) - Math.abs(parseAmount(map.debit >= 0 ? cols[map.debit] : 0)));
    const description = String(map.description >= 0 ? cols[map.description] : '').trim() || String(map.reference >= 0 ? cols[map.reference] : '').trim() || 'حركة بنكية';
    const reference = map.reference >= 0 ? latinDigits(cols[map.reference]).trim() : '';
    if (!date && !amount) return; // سطر إجمالي أو ملاحظة
    if (!date) { errors.push(`السطر ${line}: تاريخ غير مفهوم`); return; }
    if (!amount) { errors.push(`السطر ${line}: مبلغ صفري أو غير مفهوم`); return; }
    const explicitId = map.id >= 0 ? latinDigits(cols[map.id]).trim() : '';
    let external = explicitId;
    if (!external) {
      // حركتان متطابقتان تماماً في نفس الكشف تبقيان حركتين (رقم تسلسل)، وإعادة استيراد نفس الملف لا تكرّر شيئاً
      const base = `${date}|${amount}|${reference}|${description}`;
      const n = (seen.get(base) || 0) + 1; seen.set(base, n);
      external = n > 1 ? `${base}#${n}` : base;
    }
    out.push({ account_id: accountId, transaction_date: date, description, reference: reference || null, external_id: external, amount });
  });
  if (!out.length) throw new Error(errors[0] || 'الملف لا يحتوي على حركات');
  return { rows: out, errors };
}

// ---------- المطابقة ----------
const dayMs = 86400000;
export function daysBetween(a, b) {
  return Math.abs(Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`) - Date.parse(`${String(b).slice(0, 10)}T00:00:00Z`)) / dayMs;
}
function refHit(tx, tokens) {
  const hay = norm(`${tx.reference || ''} ${tx.description || ''}`);
  return tokens.some((t) => { const n = norm(t); return n.length >= 3 && hay.includes(n); });
}

// مجموع ما طابق على كل بند ← المتبقي منه
export function usedByTarget(matches) {
  const used = new Map();
  for (const m of matches || []) {
    const key = targetKey(m);
    used.set(key, round2((used.get(key) || 0) + Number(m.amount)));
  }
  return used;
}
export function targetKey(m) {
  if (m.expense_id) return `expense:${m.expense_id}`;
  if (m.invoice_payment_id) return `payment:${m.invoice_payment_id}`;
  if (m.loan_payment_id) return `loan:${m.loan_payment_id}`;
  return `payroll:${m.payroll_line_id}`;
}
export const TARGET_FIELD = { expense: 'expense_id', payment: 'invoice_payment_id', loan: 'loan_payment_id', payroll: 'payroll_line_id' };

// كل البنود القابلة للمطابقة بصيغة موحّدة
export function buildTargets({ expenses = [], payments = [], loanPayments = [], payrollLines = [] }, used) {
  const rem = (kind, id, amount) => round2(Number(amount) - (used.get(`${kind}:${id}`) || 0));
  const list = [
    ...payments.map((x) => ({
      kind: 'payment', id: x.id, date: x.paid_at, amount: Number(x.amount), remaining: rem('payment', x.id, x.amount), direction: 'in',
      label: `دفعة فاتورة ${x.invoices?.number || '—'}`, sub: x.invoices?.clients?.name || x.note || '',
      tokens: [x.invoices?.number, x.note].filter(Boolean), href: x.invoice_id ? `/invoices/${x.invoice_id}` : '/invoices',
    })),
    ...expenses.map((x) => ({
      kind: 'expense', id: x.id, date: x.expense_date, amount: Number(x.amount), remaining: rem('expense', x.id, x.amount), direction: 'out',
      label: x.description || 'مصروف', sub: x.vendor || '', tokens: [x.vendor, x.note, x.description].filter(Boolean), href: '/company-expenses',
    })),
    ...loanPayments.map((x) => ({
      kind: 'loan', id: x.id, date: x.paid_at, amount: Number(x.amount), remaining: rem('loan', x.id, x.amount), direction: 'out',
      label: `سداد قرض ${x.loans?.name || ''}`.trim(), sub: x.loans?.lender || '', tokens: [x.reference, x.loans?.lender, x.loans?.name].filter(Boolean), href: '/loans',
    })),
    ...payrollLines.map((x) => {
      const month = monthOf(x.payroll_runs?.period_month);
      return {
        kind: 'payroll', id: x.id, runId: x.run_id, month, date: lastDayOfMonth(month), amount: Number(x.net_pay), remaining: rem('payroll', x.id, x.net_pay), direction: 'out',
        label: `راتب ${x.employees?.name || 'موظف'}`, sub: `مسيّر ${month}`, tokens: [x.employees?.name].filter(Boolean), href: '/employees',
      };
    }),
  ];
  return list.filter((t) => t.amount > 0);
}
function lastDayOfMonth(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// المرشح الأفضل لكل حركة غير مكتملة: مبلغ = المتبقي من الحركة، تاريخ قريب، ومرجع يرفع الثقة.
// يشمل «مسيّر رواتب كامل» حين يطابق التحويل مجموع صافي الرواتب المتبقي في الشهر.
export function suggestMatches(transactions, targets) {
  const open = transactions.filter((t) => ['unmatched', 'partially_matched'].includes(t.status) && !t.duplicate_of);
  const runs = new Map();
  for (const t of targets) {
    if (t.kind !== 'payroll' || t.remaining <= 0.005) continue;
    const r = runs.get(t.runId) || { kind: 'payroll_run', id: t.runId, month: t.month, date: t.date, remaining: 0, lines: [], direction: 'out', label: `شهر ${t.month}`, href: '/employees', tokens: [] };
    r.remaining = round2(r.remaining + t.remaining); r.lines.push(t); r.label = `شهر ${t.month} · ${r.lines.length} موظف`; runs.set(t.runId, r);
  }
  const pool = [...targets.filter((t) => t.remaining > 0.005), ...runs.values()];
  const proposals = [];
  for (const tx of open) {
    const txRemaining = round2(Math.abs(Number(tx.amount)) - Number(tx.matched_amount || 0));
    if (txRemaining <= 0.005) continue;
    const dir = Number(tx.amount) > 0 ? 'in' : 'out';
    const scored = [];
    for (const c of pool) {
      if (c.direction !== dir || Math.abs(c.remaining - txRemaining) > 0.01) continue;
      const ref = refHit(tx, c.tokens || []);
      let days; let ok;
      if (c.kind === 'payroll' || c.kind === 'payroll_run') {
        // الرواتب تُحوَّل عادة آخر الشهر أو بدايات الشهر التالي
        const inMonth = monthOf(tx.transaction_date) === c.month;
        const after = tx.transaction_date > c.date;
        days = inMonth ? Math.min(daysBetween(tx.transaction_date, c.date), 1) : daysBetween(tx.transaction_date, after ? c.date : monthStart(c.month));
        ok = inMonth || (after ? days <= (ref ? 30 : 12) : days <= 3);
      } else {
        days = daysBetween(tx.transaction_date, c.date);
        ok = days <= (ref ? 30 : 7);
      }
      if (!ok) continue;
      // راتب موظف منفرد بلا مرجع دليله أضعف من بند مؤرخ بدقة (أي تحويل بنفس المبلغ داخل الشهر يطابقه)
      const weak = c.kind === 'payroll' && !ref ? 5 : 0;
      const confidence = Math.min(100, Math.max(55, 100 - Math.round(days * 5)) + (ref ? 20 : 0) - weak);
      scored.push({ ...c, confidence, refMatch: ref, days });
    }
    scored.sort((a, b) => b.confidence - a.confidence || Number(b.refMatch) - Number(a.refMatch) || a.days - b.days);
    if (!scored.length) continue;
    // عدة مرشحين متكافئين (نفس الثقة ونفس دليل المرجع) ← غموض: تُخفض الثقة فلا يُعتمد تلقائياً
    const tie = scored[1] && scored[1].confidence === scored[0].confidence && scored[1].refMatch === scored[0].refMatch;
    scored.forEach((c, rank) => proposals.push({ tx, candidate: rank === 0 && tie ? { ...c, confidence: Math.max(50, c.confidence - 15), ambiguous: true } : c }));
  }
  // تخصيص جشع: الأعلى ثقة أولاً؛ البند الواحد لا يُقترح لحركتين، والحركة تأخذ مرشحها التالي إن سُبقت إليه
  proposals.sort((a, b) => b.candidate.confidence - a.candidate.confidence || Number(b.candidate.refMatch) - Number(a.candidate.refMatch) || a.candidate.days - b.candidate.days);
  const taken = new Set(); const result = new Map();
  for (const p of proposals) {
    if (result.has(p.tx.id)) continue;
    const keys = p.candidate.kind === 'payroll_run' ? p.candidate.lines.map((l) => `payroll:${l.id}`) : [`${p.candidate.kind}:${p.candidate.id}`];
    if (keys.some((k) => taken.has(k))) continue;
    keys.forEach((k) => taken.add(k));
    result.set(p.tx.id, p.candidate);
  }
  return result;
}

// صفوف الإدخال في جدول المطابقات لاقتراح معيّن
export function matchRowsFor(tx, candidate, method = 'auto') {
  const base = { bank_transaction_id: tx.id, method, confidence: candidate.confidence ?? null };
  if (candidate.kind === 'payroll_run') {
    return candidate.lines.filter((l) => l.remaining > 0.005).map((l) => ({ ...base, payroll_line_id: l.id, amount: round2(l.remaining) }));
  }
  return [{ ...base, [TARGET_FIELD[candidate.kind]]: candidate.id, amount: round2(candidate.remaining) }];
}
