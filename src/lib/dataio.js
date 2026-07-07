// طبقة استيراد/تصدير البيانات — CSV (يفتح في Excel) و JSON. بلا مكتبات خارجية.
import {
  getClients, getProjects, getSuppliers, getEmployees, getInvoices, getGovernmentAccounts,
  createClient, createSupplier, createEmployee,
} from '@/lib/data';
import { SOURCE_LABEL, CLIENT_STATUS, PROJECT_STATUS, INVOICE_STATUS } from '@/lib/format';

/* ----------------------------- CSV ----------------------------- */
// تسلسل مصفوفة كائنات إلى CSV مع BOM حتى يعرض Excel العربية صحيحاً
export function toCSV(rows, columns) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => esc(c.label)).join(',');
  const body = (rows || []).map((r) => columns.map((c) => esc(r[c.k])).join(',')).join('\r\n');
  return `﻿${header}\r\n${body}`;
}

// محلّل CSV بآلة حالة يدعم علامات الاقتباس والفواصل والأسطر داخل الحقول
export function parseCSV(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = []; let field = ''; let inQuotes = false; let started = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    started = true;
    if (inQuotes) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* يُعالَج مع \n */ }
    else field += c;
  }
  if (started && (field !== '' || row.length)) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

// يحوّل نص CSV إلى كائنات بمطابقة رؤوس الأعمدة (بالتسمية العربية أو مفتاح العمود)
function csvToObjects(text, columns) {
  const grid = parseCSV(text);
  if (grid.length < 2) return [];
  const headers = grid[0].map((h) => String(h).trim());
  const idxOf = (col) => {
    let i = headers.indexOf(col.label);
    if (i === -1) i = headers.indexOf(col.k);
    return i;
  };
  const map = columns.map((col) => ({ col, i: idxOf(col) }));
  return grid.slice(1).map((cells) => {
    const obj = {};
    for (const { col, i } of map) obj[col.k] = i === -1 ? '' : String(cells[i] ?? '').trim();
    return obj;
  });
}

/* --------------------------- أدوات مساعدة --------------------------- */
const clean = (v) => { const s = String(v ?? '').trim(); return s || null; };
const reverseLabel = (labelMap) => Object.fromEntries(Object.entries(labelMap).map(([k, v]) => [(v.label || v), k]));

// يقبل مفتاح enum مباشرة أو تسميته العربية، وإلا القيمة الافتراضية
function normEnum(value, keys, labelMap, fallback) {
  const v = String(value ?? '').trim();
  if (!v) return fallback;
  if (keys.includes(v)) return v;
  const rev = reverseLabel(labelMap);
  return rev[v] || fallback;
}

const CLIENT_SOURCES = ['instagram', 'tiktok', 'referral', 'client_referral', 'employee_referral', 'other'];
const CLIENT_STATUSES = ['lead', 'active', 'completed', 'waiting'];
const EMP_WAGES = ['fixed', 'daily', 'hourly'];
const EMP_STATUSES = ['active', 'on_project', 'inactive'];
const WAGE_LABELS = { fixed: 'ثابت', daily: 'يومي', hourly: 'بالساعة' };
const EMP_STATUS_LABELS = { active: 'نشط', on_project: 'في مشروع', inactive: 'غير نشط' };

/* --------------------------- سجل الكيانات --------------------------- */
// كل كيان: أعمدة التصدير/الاستيراد + دوال الجلب والإنشاء والتحقق ومنع التكرار
export const ENTITIES = {
  clients: {
    label: 'العملاء',
    importable: true,
    columns: [
      { k: 'name', label: 'الاسم' },
      { k: 'phone', label: 'الجوال' },
      { k: 'source', label: 'المصدر' },
      { k: 'district', label: 'الحي' },
      { k: 'status', label: 'الحالة' },
      { k: 'first_contact_at', label: 'أول تواصل' },
      { k: 'code', label: 'الكود' },
      { k: 'notes', label: 'ملاحظات' },
    ],
    fetchExport: async () => (await getClients()).map((c) => ({
      name: c.name, phone: c.phone, source: c.source, district: c.district,
      status: c.status, first_contact_at: c.first_contact_at, code: c.code, notes: c.notes,
    })),
    fetchExisting: getClients,
    dedupeKey: (r) => (r.phone ? `p:${String(r.phone).trim()}` : `n:${String(r.name).trim()}`),
    buildPayload: (raw) => ({
      name: clean(raw.name),
      phone: clean(raw.phone),
      source: normEnum(raw.source, CLIENT_SOURCES, SOURCE_LABEL, 'other'),
      district: clean(raw.district),
      status: normEnum(raw.status, CLIENT_STATUSES, CLIENT_STATUS, 'active'),
      first_contact_at: clean(raw.first_contact_at),
      notes: clean(raw.notes),
    }),
    validate: (p) => (p.name ? null : 'اسم العميل مطلوب'),
    create: createClient,
  },
  suppliers: {
    label: 'الموردون',
    importable: true,
    columns: [
      { k: 'name', label: 'المورّد' },
      { k: 'category', label: 'التصنيف' },
      { k: 'city', label: 'المدينة' },
    ],
    fetchExport: async () => (await getSuppliers()).map((s) => ({ name: s.name, category: s.category, city: s.city })),
    fetchExisting: getSuppliers,
    dedupeKey: (r) => `n:${String(r.name).trim()}`,
    buildPayload: (raw) => ({ name: clean(raw.name), category: clean(raw.category) || 'أخرى', city: clean(raw.city) }),
    validate: (p) => (p.name ? null : 'اسم المورّد مطلوب'),
    create: createSupplier,
  },
  employees: {
    label: 'الموظفون',
    importable: true,
    columns: [
      { k: 'name', label: 'الاسم' },
      { k: 'role', label: 'الدور' },
      { k: 'phone', label: 'الجوال' },
      { k: 'national_id', label: 'الهوية/الإقامة' },
      { k: 'nationality', label: 'الجنسية' },
      { k: 'wage', label: 'نوع الأجر' },
      { k: 'status', label: 'الحالة' },
    ],
    fetchExport: async () => (await getEmployees()).map((e) => ({
      name: e.name, role: e.role, phone: e.phone, national_id: e.national_id,
      nationality: e.nationality, wage: e.wage, status: e.status,
    })),
    fetchExisting: getEmployees,
    dedupeKey: (r) => (r.national_id ? `id:${String(r.national_id).trim()}` : `n:${String(r.name).trim()}`),
    buildPayload: (raw) => ({
      name: clean(raw.name), role: clean(raw.role), phone: clean(raw.phone),
      national_id: clean(raw.national_id), nationality: clean(raw.nationality),
      wage: normEnum(raw.wage, EMP_WAGES, WAGE_LABELS, 'fixed'),
      status: normEnum(raw.status, EMP_STATUSES, EMP_STATUS_LABELS, 'active'),
    }),
    validate: (p) => (p.name ? null : 'اسم الموظف مطلوب'),
    create: createEmployee,
  },
  projects: {
    label: 'المشاريع',
    importable: false,
    columns: [
      { k: 'title', label: 'المشروع' },
      { k: 'client', label: 'العميل' },
      { k: 'service_type', label: 'الخدمة' },
      { k: 'sale_price', label: 'قيمة العقد' },
      { k: 'status', label: 'الحالة' },
      { k: 'start_date', label: 'البداية' },
      { k: 'due_date', label: 'التسليم' },
    ],
    fetchExport: async () => {
      const [projects, clients] = await Promise.all([getProjects(), getClients()]);
      const byId = Object.fromEntries(clients.map((c) => [c.id, c.name]));
      return projects.map((p) => ({
        title: p.title, client: byId[p.client_id] || '', service_type: p.service_type,
        sale_price: p.sale_price, status: PROJECT_STATUS[p.status]?.label || p.status,
        start_date: p.start_date, due_date: p.due_date,
      }));
    },
  },
  invoices: {
    label: 'الفواتير',
    importable: false,
    columns: [
      { k: 'number', label: 'رقم الفاتورة' },
      { k: 'client', label: 'العميل' },
      { k: 'issue_at', label: 'الإصدار' },
      { k: 'due_at', label: 'الاستحقاق' },
      { k: 'total', label: 'الإجمالي' },
      { k: 'paid', label: 'المحصّل' },
      { k: 'remaining', label: 'المتبقي' },
      { k: 'status', label: 'الحالة' },
    ],
    fetchExport: async () => {
      const [invoices, clients] = await Promise.all([getInvoices(), getClients()]);
      const byId = Object.fromEntries(clients.map((c) => [c.id, c.name]));
      return invoices.map((v) => ({
        number: v.number, client: byId[v.client_id] || '',
        issue_at: v.issue_at ? String(v.issue_at).slice(0, 10) : '',
        due_at: v.due_at ? String(v.due_at).slice(0, 10) : '',
        total: v.total, paid: v.paid_amount, remaining: v.remaining_amount,
        status: INVOICE_STATUS[v.status]?.label || v.status,
      }));
    },
  },
  government: {
    label: 'الجهات الحكومية',
    importable: false,
    columns: [
      { k: 'entity_name', label: 'الجهة' },
      { k: 'login_url', label: 'رابط الدخول' },
      { k: 'username', label: 'اسم المستخدم' },
      { k: 'contact', label: 'التواصل' },
      { k: 'expiry_date', label: 'الانتهاء' },
      { k: 'status', label: 'الحالة' },
    ],
    fetchExport: async () => (await getGovernmentAccounts()).map((g) => ({
      entity_name: g.entity_name, login_url: g.login_url, username: g.username,
      contact: g.contact, expiry_date: g.expiry_date, status: g.status,
    })),
  },
};

export const EXPORTABLE = Object.entries(ENTITIES).map(([key, e]) => ({ key, label: e.label }));
export const IMPORTABLE = Object.entries(ENTITIES).filter(([, e]) => e.importable).map(([key, e]) => ({ key, label: e.label }));

/* ----------------------------- التنزيل ----------------------------- */
export function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export async function exportEntity(entityKey, format) {
  const entity = ENTITIES[entityKey];
  const rows = await entity.fetchExport();
  if (format === 'json') {
    downloadBlob(JSON.stringify(rows, null, 2), `tarteeb-${entityKey}-${stamp()}.json`, 'application/json');
  } else {
    downloadBlob(toCSV(rows, entity.columns), `tarteeb-${entityKey}-${stamp()}.csv`, 'text/csv;charset=utf-8');
  }
  return rows.length;
}

// نسخة احتياطية كاملة لكل الكيانات في ملف JSON واحد
export async function exportFullBackup() {
  const out = { _app: 'tarteeb', _exported_at: new Date().toISOString(), data: {} };
  for (const [key, entity] of Object.entries(ENTITIES)) {
    out.data[key] = await entity.fetchExport();
  }
  downloadBlob(JSON.stringify(out, null, 2), `tarteeb-backup-${stamp()}.json`, 'application/json');
  return Object.keys(out.data).length;
}

/* ----------------------------- الاستيراد ----------------------------- */
// يقرأ ملف CSV/JSON ويعيد صفوفاً خام (كائنات نصية) للكيان المحدّد
export async function readImportFile(file, entityKey) {
  const entity = ENTITIES[entityKey];
  const text = await file.text();
  const isJson = file.name.toLowerCase().endsWith('.json') || text.trim().startsWith('[') || text.trim().startsWith('{');
  if (isJson) {
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error('ملف JSON غير صالح'); }
    if (Array.isArray(parsed)) return parsed;
    if (parsed && parsed.data && Array.isArray(parsed.data[entityKey])) return parsed.data[entityKey];
    if (parsed && Array.isArray(parsed[entityKey])) return parsed[entityKey];
    throw new Error('لم يُعثر على صفوف قابلة للاستيراد في الملف');
  }
  return csvToObjects(text, entity.columns);
}

// يستورد الصفوف: تحقق + منع تكرار + إدراج، مع تقرير مفصّل وتحديث تقدّم
export async function importRows(entityKey, rawRows, { existing, onProgress } = {}) {
  const entity = ENTITIES[entityKey];
  if (!entity?.importable) throw new Error('هذا الكيان غير قابل للاستيراد');
  const base = existing || await entity.fetchExisting();
  const seen = new Set(base.map((r) => entity.dedupeKey(r)).filter(Boolean));
  const result = { total: rawRows.length, added: 0, skipped: 0, errors: [], created: [] };

  for (let i = 0; i < rawRows.length; i++) {
    try {
      const payload = entity.buildPayload(rawRows[i]);
      const invalid = entity.validate(payload);
      if (invalid) { result.errors.push(`السطر ${i + 2}: ${invalid}`); continue; }
      const key = entity.dedupeKey(payload);
      if (key && seen.has(key)) { result.skipped += 1; continue; }
      const created = await entity.create(payload);
      if (key) seen.add(key);
      result.added += 1;
      if (created) result.created.push(created);
    } catch (e) {
      result.errors.push(`السطر ${i + 2}: ${e.message || 'تعذّر الحفظ'}`);
    }
    if (onProgress) onProgress(i + 1, rawRows.length);
  }
  return result;
}
