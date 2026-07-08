// طبقة استيراد/تصدير البيانات — CSV (يفتح في Excel) و JSON. بلا مكتبات خارجية.
import {
  getClients, getProjects, getSuppliers, getEmployees, getInvoices, getGovernmentAccounts,
  getAllProjectCostsDetailed,
  createClient, createSupplier, createEmployee, createProject, createProjectCost,
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

// يحوّل نصاً رقمياً (بفواصل آلاف أو أرقام عربية) إلى رقم، وإلا 0
const num = (v) => {
  const s = String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[,،\s]/g, '').replace(/[^\d.-]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round(n * 100) / 100;

const CLIENT_SOURCES = ['instagram', 'tiktok', 'referral', 'client_referral', 'employee_referral', 'other'];
const CLIENT_STATUSES = ['lead', 'active', 'completed', 'waiting'];
const PROJECT_STATUSES = ['quote', 'preparing', 'in_progress', 'delivered', 'completed', 'cancelled'];
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
    example: {
      name: 'سارة البراهيم', phone: '0501234567', source: 'انستقرام', district: 'النرجس',
      status: 'عميل نشط', first_contact_at: '2026-07-01', code: '', notes: 'عميلة مميزة',
    },
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
    example: { name: 'مؤسسة النخبة للتخزين', category: 'تخزين', city: 'الرياض' },
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
    example: {
      name: 'دلال الجعويني', role: 'منظم مساحات', phone: '0555555555',
      national_id: '1234567890', nationality: 'سعودية', wage: 'يومي', status: 'نشط',
    },
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

  // ملخص حسابات العملاء والمنظمات: كل صف = عميل + مشروع + تفكيك تكاليف (خدمة + منظمات بهامش)
  // الأعمدة المشتقّة (ربح الخدمة/نسبها/ربح المنظمات) تُحسب عند التصدير وتُتجاهل عند الاستيراد
  accounts: {
    label: 'ملخص العملاء والمنظمات',
    importable: true,
    columns: [
      { k: 'name', label: 'الاسم' },
      { k: 'date', label: 'التاريخ' },
      { k: 'sale', label: 'مبلغ البيع' },
      { k: 'service_cost', label: 'مصاريف الخدمة' },
      { k: 'service_profit', label: 'ربح الخدمة' },
      { k: 'service_margin', label: 'نسبة ربح الخدمة (%)' },
      { k: 'org_markup', label: 'نسبة إضافة المنظمات (%)' },
      { k: 'org_before', label: 'المنظمات قبل الإضافة' },
      { k: 'org_after', label: 'المنظمات بعد الإضافة' },
      { k: 'org_profit', label: 'ربح المنظمات' },
      { k: 'notes', label: 'ملاحظات' },
      { k: 'phone', label: 'الجوال' },
      { k: 'source', label: 'المصدر' },
      { k: 'district', label: 'الحي' },
      { k: 'status', label: 'الحالة' },
    ],
    fetchExport: async () => {
      const [projects, clients, costs] = await Promise.all([getProjects(), getClients(), getAllProjectCostsDetailed()]);
      const byId = Object.fromEntries(clients.map((c) => [c.id, c]));
      const costsByProject = {};
      for (const c of costs) (costsByProject[c.project_id] ||= []).push(c);
      return projects.map((p) => {
        const rows = costsByProject[p.id] || [];
        const mats = rows.filter((r) => r.kind === 'materials');
        const orgBefore = round2(mats.reduce((s, r) => s + Number(r.amount || 0), 0));
        const orgAfter = round2(mats.reduce((s, r) => s + Number(r.sale_price || r.amount || 0), 0));
        const serviceCost = round2(rows.filter((r) => r.kind !== 'materials').reduce((s, r) => s + Number(r.amount || 0), 0));
        const sale = Number(p.sale_price || 0);
        const serviceRevenue = sale - orgAfter;
        const serviceProfit = round2(serviceRevenue - serviceCost);
        const c = byId[p.client_id] || {};
        return {
          name: c.name || '',
          date: p.due_date || p.start_date || '',
          sale,
          service_cost: serviceCost,
          service_profit: serviceProfit,
          service_margin: serviceRevenue > 0 ? Math.round((serviceProfit / serviceRevenue) * 100) : 0,
          org_markup: orgBefore > 0 ? Math.round((orgAfter / orgBefore - 1) * 100) : 0,
          org_before: orgBefore,
          org_after: orgAfter,
          org_profit: round2(orgAfter - orgBefore),
          notes: p.title && p.title !== 'مشروع تنظيم' ? p.title : (c.notes || ''),
          phone: c.phone || '',
          source: SOURCE_LABEL[c.source] || c.source || '',
          district: c.district || '',
          status: PROJECT_STATUS[p.status]?.label || p.status || '',
        };
      });
    },
    // منع التكرار: نفس العميل + التاريخ + مبلغ البيع = نفس السجل
    fetchExisting: async () => {
      const [projects, clients] = await Promise.all([getProjects(), getClients()]);
      const byId = Object.fromEntries(clients.map((c) => [c.id, c.name]));
      return projects.map((p) => ({
        _name: byId[p.client_id] || '', _date: p.due_date || p.start_date || '', _sale: Number(p.sale_price || 0),
      }));
    },
    dedupeKey: (r) => {
      const name = (r._name ?? r.name ?? '').toString().trim();
      const date = (r._date ?? r.date ?? '').toString().trim();
      const sale = r._sale ?? num(r.sale);
      return name ? `${name}|${date}|${sale}` : '';
    },
    buildPayload: (raw) => ({
      client: {
        name: clean(raw.name),
        phone: clean(raw.phone),
        source: normEnum(raw.source, CLIENT_SOURCES, SOURCE_LABEL, 'other'),
        district: clean(raw.district),
      },
      project: {
        date: clean(raw.date),
        sale: num(raw.sale),
        status: normEnum(raw.status, PROJECT_STATUSES, PROJECT_STATUS, 'delivered'),
        notes: clean(raw.notes),
      },
      serviceCost: num(raw.service_cost),
      org: { before: num(raw.org_before), after: num(raw.org_after), markup: num(raw.org_markup) },
      name: clean(raw.name), date: clean(raw.date), sale: num(raw.sale),
    }),
    validate: (p) => (p.client.name ? null : 'اسم العميل مطلوب'),
    // إنشاء متعدّد الجداول: عميل (أو استخدام الموجود) + مشروع + بنود تكلفة
    create: async (p) => {
      const existingClients = await getClients();
      const key = (c) => (c.phone ? `p:${String(c.phone).trim()}` : `n:${String(c.name).trim()}`);
      const wantKey = p.client.phone ? `p:${p.client.phone}` : `n:${p.client.name}`;
      let client = existingClients.find((c) => key(c) === wantKey);
      if (!client) client = await createClient({ ...p.client, status: 'active' });

      const project = await createProject({
        client_id: client.id,
        title: p.project.notes || 'مشروع تنظيم',
        sale_price: p.project.sale,
        status: p.project.status,
        start_date: p.project.date || null,
        due_date: p.project.date || null,
      });

      if (p.serviceCost > 0) {
        await createProjectCost({ project_id: project.id, kind: 'other', label: 'مصاريف الخدمة', amount: p.serviceCost });
      }
      if (p.org.before > 0 || p.org.after > 0) {
        await createProjectCost({
          project_id: project.id, kind: 'materials', product_name: 'منظمات',
          amount: p.org.before, sale_price: p.org.after || null,
          markup_percent: p.org.markup || null,
        });
      }
      return project;
    },
    example: {
      name: 'سارة البراهيم', date: '2026-07-01', sale: '6800', service_cost: '2000',
      service_profit: '', service_margin: '', org_markup: '30', org_before: '2000', org_after: '2600',
      org_profit: '', notes: 'تنظيم مطبخ', phone: '0501234567', source: 'انستقرام', district: 'جرير', status: 'مكتمل',
    },
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

// قالب استيراد معتمد: رؤوس الأعمدة الصحيحة + صف توضيحي واحد يبيّن القيم المقبولة
export function templateCSV(entityKey) {
  const entity = ENTITIES[entityKey];
  const rows = entity.example ? [entity.example] : [];
  return toCSV(rows, entity.columns);
}

export function downloadTemplate(entityKey, format = 'csv') {
  const entity = ENTITIES[entityKey];
  if (format === 'json') {
    const sample = entity.example ? [entity.example] : [];
    downloadBlob(JSON.stringify(sample, null, 2), `tarteeb-template-${entityKey}.json`, 'application/json');
  } else {
    downloadBlob(templateCSV(entityKey), `tarteeb-template-${entityKey}.csv`, 'text/csv;charset=utf-8');
  }
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
