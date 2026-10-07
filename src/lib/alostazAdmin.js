// ============================================================
//  تكامل alostaz.io — سيرفر فقط
//  يقرأ/يكتب داخل alostaz_settings عبر supabaseAdmin (service role)،
//  فلا يُكشف token إطلاقاً للمتصفح. يُستخدم من مسارات src/app/api فقط.
// ============================================================
import { supabaseAdmin, supabaseAdminReady } from './supabaseAdmin';

export async function getAlostazSettings() {
  if (!supabaseAdminReady) return null;
  const { data, error } = await supabaseAdmin.from('alostaz_settings').select('*').maybeSingle();
  if (error) throw error;
  return data;
}

function normalizeBaseUrl(input) {
  let s = (input || '').trim();
  s = s.replace(/\/+$/, '');
  return s;
}

export async function saveAlostazSettings({
  base_url: baseUrl, token, branch_id: branchId, api_version: apiVersion, locale,
  default_treasury_id: defaultTreasuryId, default_product_id: defaultProductId, default_storehouse_id: defaultStorehouseId,
  enabled,
}) {
  const existing = await getAlostazSettings();
  const payload = {
    base_url: normalizeBaseUrl(baseUrl),
    token: token.trim(),
    branch_id: (branchId || '').trim(),
    api_version: (apiVersion || '').trim(),
    locale: (locale || 'ar').trim().toLowerCase() === 'en' ? 'en' : 'ar',
    default_treasury_id: (defaultTreasuryId || '').trim() || null,
    default_product_id: (defaultProductId || '').trim() || null,
    default_storehouse_id: (defaultStorehouseId || '').trim() || null,
    enabled: enabled !== false,
    last_sync_error: null,
  };
  const { data, error } = existing
    ? await supabaseAdmin.from('alostaz_settings').update(payload).eq('id', existing.id).select('*').single()
    : await supabaseAdmin.from('alostaz_settings').insert(payload).select('*').single();
  if (error) throw error;
  return data;
}

export async function clearAlostazSettings() {
  const existing = await getAlostazSettings();
  if (!existing) return;
  const { error } = await supabaseAdmin.from('alostaz_settings').delete().eq('id', existing.id);
  if (error) throw error;
}

async function recordSyncResult({ ok, error }) {
  const existing = await getAlostazSettings();
  if (!existing) return;
  await supabaseAdmin.from('alostaz_settings').update({
    last_sync_at: new Date().toISOString(),
    last_sync_error: ok ? null : (error || 'خطأ غير معروف'),
  }).eq('id', existing.id);
}

async function alostazFetch(settings, path, { method = 'GET', body } = {}) {
  const url = `${settings.base_url}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.token}`,
      'X-Branch-Id': settings.branch_id || '',
      'X-Locale': settings.locale || 'ar',
      'X-API-Version': settings.api_version || '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* استجابة بلا جسم JSON */ }
  if (!res.ok) {
    const message = json?.errors ? JSON.stringify(json.errors) : (json?.message || `خطأ alostaz.io (${res.status})`);
    throw new Error(message);
  }
  return json;
}

// يتحقق من صحة الإعدادات (base_url/token/branch_id/api_version) قبل حفظها
export async function testAlostazConnection(settings) {
  await alostazFetch(settings, '/partners?per_page=1');
}

function mapClientToAlostazPayload(client) {
  const payload = {
    type: 'client',
    name: client.name,
    nature: 'individual', // لا مفهوم "منشأة" في نموذج عميل ترتيب الحالي
  };
  if (client.code) payload.code = client.code;
  if (client.notes) payload.notes = client.notes;
  if (client.phone) payload.contacts = [{ phone: client.phone }];
  return payload;
}

// يدفع عميلاً واحداً من ترتيب إلى alostaz.io: إنشاء أول مرة، تعديل لاحقاً.
// اتجاه واحد فقط (ترتيب → alostaz.io)، بلا تأثير على بيانات ترتيب عند الفشل
// غير تسجيل سبب الخطأ على سجل العميل نفسه.
export async function pushClientToAlostaz(clientId) {
  const settings = await getAlostazSettings();
  if (!settings?.enabled || !settings?.base_url || !settings?.token) {
    return { skipped: true, reason: 'الربط مع alostaz.io غير مفعّل' };
  }

  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('id,code,name,phone,notes,alostaz_partner_id')
    .eq('id', clientId)
    .maybeSingle();
  if (clientError) throw clientError;
  if (!client) throw new Error('العميل غير موجود');

  const payload = mapClientToAlostazPayload(client);

  try {
    let partnerId = client.alostaz_partner_id;
    if (partnerId) {
      await alostazFetch(settings, `/partners/${partnerId}`, { method: 'PUT', body: payload });
    } else {
      const created = await alostazFetch(settings, '/partners', { method: 'POST', body: payload });
      partnerId = created?.data?.id || created?.id;
      if (!partnerId) throw new Error('لم يُرجع alostaz.io معرّف العميل الجديد');
    }

    await supabaseAdmin.from('clients').update({
      alostaz_partner_id: partnerId,
      alostaz_synced_at: new Date().toISOString(),
      alostaz_sync_error: null,
    }).eq('id', clientId);
    await recordSyncResult({ ok: true });
    return { ok: true, alostaz_partner_id: partnerId };
  } catch (error) {
    const message = error.message || 'تعذّرت المزامنة مع alostaz.io';
    await supabaseAdmin.from('clients').update({ alostaz_sync_error: message }).eq('id', clientId);
    await recordSyncResult({ ok: false, error: message });
    return { ok: false, error: message };
  }
}

// مزامنة دفعية لكل العملاء الذين لم يُزامَنوا بعد (أو الكل عند force)
export async function pushAllClientsToAlostaz({ force = false } = {}) {
  const settings = await getAlostazSettings();
  if (!settings?.enabled || !settings?.base_url || !settings?.token) {
    return { skipped: true, reason: 'الربط مع alostaz.io غير مفعّل' };
  }
  let query = supabaseAdmin.from('clients').select('id');
  if (!force) query = query.is('alostaz_partner_id', null);
  const { data: rows, error } = await query;
  if (error) throw error;

  let synced = 0;
  const errors = [];
  for (const row of rows || []) {
    // تسلسلي عمداً لتفادي تجاوز حدود المعدل بحساب alostaz.io
    // eslint-disable-next-line no-await-in-loop
    const result = await pushClientToAlostaz(row.id);
    if (result.ok) synced += 1;
    else if (!result.skipped) errors.push({ client_id: row.id, error: result.error });
  }
  return { total: rows?.length || 0, synced, errors };
}

/* ============================ الفواتير ودفعاتها ============================ */

// alostaz.io يتطلب product_id/storehouse_id حقيقيَّين لكل بند فاتورة، وترتيب
// لا يملك كتالوج منتجات حقيقي (فواتير بنود وصفية فقط) — لذا تُنسب كل البنود
// لمنتج/مخزن افتراضيَّين عامَّين يحدَّدان مرة واحدة من إعدادات الربط.
// ملاحظة مبالغ: alostaz.io يمثّل كل مبلغ كعدد صحيح = القيمة بالريال × 1000
// (وُثِّق تجريبياً: unit_price=1000 ⇐ فاتورة بقيمة 1 ريال)، فلا فقدان دقة.
const AMOUNT_SCALE = 1000;
const toAlostazAmount = (sar) => Math.round((Number(sar) || 0) * AMOUNT_SCALE);

function mapInvoiceToAlostazPayload(invoice, items, settings) {
  const lineItems = (items || []).map((item) => ({
    product_id: Number(settings.default_product_id),
    storehouse_id: Number(settings.default_storehouse_id),
    description: item.description || '',
    unit_quantity: 1,
    unit_content: 1,
    // نطوي الكمية والسعر في مبلغ البند الكامل بدل تمثيل كميات كسرية (alostaz.io يتطلب unit_quantity صحيحاً)
    unit_price: toAlostazAmount((Number(item.qty) || 1) * (Number(item.unit_price) || 0)),
  }));
  if (invoice.vat_applicable && Number(invoice.vat_amount) > 0) {
    lineItems.push({
      product_id: Number(settings.default_product_id),
      storehouse_id: Number(settings.default_storehouse_id),
      description: `ضريبة القيمة المضافة (${invoice.vat_rate}%)`,
      unit_quantity: 1,
      unit_content: 1,
      unit_price: toAlostazAmount(invoice.vat_amount),
    });
  }
  return {
    variant: 'standard',
    nature: 'sale',
    type: 'invoice',
    status: invoice.status === 'draft' ? 'draft' : 'issued',
    issue_date: new Date(invoice.issue_at).toISOString(),
    due_date: new Date(invoice.due_at || invoice.issue_at).toISOString(),
    partner_id: Number(invoice.alostazPartnerId),
    line_items: lineItems,
  };
}

// يدفع فاتورة واحدة (برأسها وبنودها) إلى alostaz.io، ثم أي دفعات لم تُزامَن بعد.
// يزامن عميل الفاتورة أولاً تلقائياً إن لم يكن مزامَناً من قبل (الفاتورة تتطلب partner_id).
export async function pushInvoiceToAlostaz(invoiceId) {
  const settings = await getAlostazSettings();
  if (!settings?.enabled || !settings?.base_url || !settings?.token) {
    return { skipped: true, reason: 'الربط مع alostaz.io غير مفعّل' };
  }
  if (!settings?.default_product_id || !settings?.default_storehouse_id) {
    return { skipped: true, reason: 'حدِّد المنتج والمخزن الافتراضيَّين في إعدادات الربط أولاً' };
  }

  const { data: invoice, error: invoiceError } = await supabaseAdmin
    .from('invoices')
    .select('id,client_id,issue_at,due_at,status,vat_applicable,vat_rate,vat_amount,alostaz_invoice_id')
    .eq('id', invoiceId)
    .maybeSingle();
  if (invoiceError) throw invoiceError;
  if (!invoice) throw new Error('الفاتورة غير موجودة');
  if (invoice.status === 'refunded') return { skipped: true, reason: 'الفواتير المرتجعة لا تُزامَن حالياً' };
  if (!invoice.client_id) return { skipped: true, reason: 'الفاتورة بلا عميل مرتبط' };

  let { data: client, error: clientError } = await supabaseAdmin
    .from('clients').select('id,alostaz_partner_id').eq('id', invoice.client_id).maybeSingle();
  if (clientError) throw clientError;
  if (!client) return { skipped: true, reason: 'عميل الفاتورة غير موجود' };

  if (!client.alostaz_partner_id) {
    const clientResult = await pushClientToAlostaz(client.id);
    if (!clientResult.ok) {
      const message = clientResult.reason || clientResult.error || 'تعذّرت مزامنة عميل الفاتورة أولاً';
      await supabaseAdmin.from('invoices').update({ alostaz_sync_error: message }).eq('id', invoiceId);
      return { ok: false, error: message };
    }
    client = { ...client, alostaz_partner_id: clientResult.alostaz_partner_id };
  }

  const { data: items, error: itemsError } = await supabaseAdmin
    .from('invoice_items').select('description,qty,unit_price').eq('invoice_id', invoiceId);
  if (itemsError) throw itemsError;

  const payload = mapInvoiceToAlostazPayload(
    { ...invoice, alostazPartnerId: client.alostaz_partner_id },
    items,
    settings,
  );

  try {
    let alostazId = invoice.alostaz_invoice_id;
    if (!alostazId) {
      const created = await alostazFetch(settings, '/invoices', { method: 'POST', body: payload });
      alostazId = created?.data?.id || created?.id;
      if (!alostazId) throw new Error('لم يُرجع alostaz.io معرّف الفاتورة الجديدة');
    } else if (invoice.status === 'draft') {
      // فاتورة ما زالت مسودة في ترتيب ⇐ غالباً لا تزال مسودة في alostaz.io أيضاً فتقبل تعديلاً.
      // التعديل لا يقبل partner_id — نرسل بقية الحقول القابلة للتعديل فقط.
      const { partner_id: _partnerId, nature: _nature, type: _type, variant: _variant, ...updatable } = payload;
      await alostazFetch(settings, `/invoices/${alostazId}`, { method: 'PUT', body: updatable });
    }
    // وإلا: الفاتورة أُصدرت فعلاً في alostaz.io — يمنع نظام الزكاة والضريبة والجمارك (ZATCA)
    // تعديل أو حذف فاتورة بعد إصدارها، فلا داعٍ لمحاولة PUT؛ نكتفي بمزامنة أي دفعات جديدة أدناه.

    await supabaseAdmin.from('invoices').update({
      alostaz_invoice_id: alostazId,
      alostaz_synced_at: new Date().toISOString(),
      alostaz_sync_error: null,
    }).eq('id', invoiceId);

    const paymentsResult = await pushPendingInvoicePayments(invoiceId, alostazId, client.alostaz_partner_id, settings);
    await recordSyncResult({ ok: true });
    return { ok: true, alostaz_invoice_id: alostazId, payments: paymentsResult };
  } catch (error) {
    const message = error.message || 'تعذّرت مزامنة الفاتورة مع alostaz.io';
    await supabaseAdmin.from('invoices').update({ alostaz_sync_error: message }).eq('id', invoiceId);
    await recordSyncResult({ ok: false, error: message });
    return { ok: false, error: message };
  }
}

// يرسل أي دفعات لهذه الفاتورة لم تُزامَن بعد (alostaz_payment_id فارغ) — إضافة فقط،
// بلا تعديل/حذف. تُسجَّل كـ partner-payments واردة (incoming) ومُسوَّاة على الفاتورة.
async function pushPendingInvoicePayments(invoiceId, alostazInvoiceId, alostazPartnerId, settings) {
  if (!settings.default_treasury_id) {
    return { total: 0, synced: 0, errors: [{ error: 'لم تُحدَّد الخزنة الافتراضية — الدفعات لم تُزامَن' }] };
  }
  const { data: payments, error } = await supabaseAdmin
    .from('invoice_payments')
    .select('id,amount,paid_at,note')
    .eq('invoice_id', invoiceId)
    .is('alostaz_payment_id', null);
  if (error) throw error;

  let synced = 0;
  const errors = [];
  for (const payment of payments || []) {
    // استثناء مؤكَّد تجريبياً: amount في partner-payments بالريال الفعلي مباشرة
    // (بعكس unit_price في بنود الفواتير الذي يُضرب في AMOUNT_SCALE).
    const amount = Math.round(Number(payment.amount) || 0);
    const body = {
      partner_type: 'client',
      partner_id: Number(alostazPartnerId),
      treasury_id: Number(settings.default_treasury_id),
      type: 'incoming',
      amount,
      date: (payment.paid_at || '').slice(0, 10),
      description: payment.note || undefined,
      invoices: [{ id: Number(alostazInvoiceId), pivot: { amount } }],
    };
    try {
      // تسلسلي عمداً — نفس سبب تسلسل مزامنة العملاء
      // eslint-disable-next-line no-await-in-loop
      const created = await alostazFetch(settings, '/partner-payments', { method: 'POST', body });
      // eslint-disable-next-line no-await-in-loop
      await supabaseAdmin.from('invoice_payments').update({
        alostaz_payment_id: created?.data?.id || created?.id || null,
        alostaz_synced_at: new Date().toISOString(),
        alostaz_sync_error: null,
      }).eq('id', payment.id);
      synced += 1;
    } catch (payErr) {
      const message = payErr.message || 'تعذّرت مزامنة الدفعة';
      // eslint-disable-next-line no-await-in-loop
      await supabaseAdmin.from('invoice_payments').update({ alostaz_sync_error: message }).eq('id', payment.id);
      errors.push({ payment_id: payment.id, error: message });
    }
  }
  return { total: payments?.length || 0, synced, errors };
}

// مزامنة دفعية لكل الفواتير غير المرتجعة التي لم تُزامَن بعد (أو الكل عند force)
export async function pushAllInvoicesToAlostaz({ force = false } = {}) {
  const settings = await getAlostazSettings();
  if (!settings?.enabled || !settings?.base_url || !settings?.token) {
    return { skipped: true, reason: 'الربط مع alostaz.io غير مفعّل' };
  }
  let query = supabaseAdmin.from('invoices').select('id').neq('status', 'refunded');
  if (!force) query = query.is('alostaz_invoice_id', null);
  const { data: rows, error } = await query;
  if (error) throw error;

  let synced = 0;
  const errors = [];
  for (const row of rows || []) {
    // eslint-disable-next-line no-await-in-loop
    const result = await pushInvoiceToAlostaz(row.id);
    if (result.ok) synced += 1;
    else if (!result.skipped) errors.push({ invoice_id: row.id, error: result.error });
  }
  return { total: rows?.length || 0, synced, errors };
}
