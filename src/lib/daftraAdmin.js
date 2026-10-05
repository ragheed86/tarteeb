// ============================================================
//  تكامل دفترة (Daftra) — سيرفر فقط
//  يقرأ/يكتب داخل daftra_settings عبر supabaseAdmin (service role)،
//  فلا يُكشف api_key إطلاقاً للمتصفح. يُستخدم من مسارات src/app/api فقط.
// ============================================================
import { supabaseAdmin, supabaseAdminReady } from './supabaseAdmin';

const DAFTRA_API_DOMAIN = 'daftra.com'; // النطاق الفعلي لمنتج دفترة (داخل subdomain.daftra.com)
const DAFTRA_FORMAT = '.json';

// يتسامح مع لصق الرابط كاملاً (https://x.daftra.com/) ويُرجع subdomain الخام فقط
export function normalizeDaftraSubdomain(input) {
  let s = (input || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '');
  s = s.replace(/\.daftra\.com.*$/, '');
  s = s.replace(/\/.*$/, '');
  return s;
}

export async function getDaftraSettings() {
  if (!supabaseAdminReady) return null;
  const { data, error } = await supabaseAdmin.from('daftra_settings').select('*').maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveDaftraSettings({
  subdomain, api_key: apiKey, enabled, default_country_code: countryCode, default_currency_code: currencyCode,
}) {
  const existing = await getDaftraSettings();
  const payload = {
    subdomain: normalizeDaftraSubdomain(subdomain),
    api_key: apiKey.trim(),
    enabled: enabled !== false,
    default_country_code: (countryCode || 'SA').trim().toUpperCase(),
    default_currency_code: (currencyCode || 'SAR').trim().toUpperCase(),
    last_sync_error: null,
  };
  const { data, error } = existing
    ? await supabaseAdmin.from('daftra_settings').update(payload).eq('id', existing.id).select('*').single()
    : await supabaseAdmin.from('daftra_settings').insert(payload).select('*').single();
  if (error) throw error;
  return data;
}

export async function clearDaftraSettings() {
  const existing = await getDaftraSettings();
  if (!existing) return;
  const { error } = await supabaseAdmin.from('daftra_settings').delete().eq('id', existing.id);
  if (error) throw error;
}

async function recordSyncResult({ ok, error }) {
  const existing = await getDaftraSettings();
  if (!existing) return;
  await supabaseAdmin.from('daftra_settings').update({
    last_sync_at: new Date().toISOString(),
    last_sync_error: ok ? null : (error || 'خطأ غير معروف'),
  }).eq('id', existing.id);
}

async function daftraFetch(settings, path, { method = 'GET', body } = {}) {
  const url = `https://${settings.subdomain}.${DAFTRA_API_DOMAIN}/api2${path}${DAFTRA_FORMAT}`;
  const res = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      apikey: settings.api_key,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* استجابة بلا جسم JSON */ }
  if (!res.ok) {
    const message = json?.errors ? JSON.stringify(json.errors) : (json?.message || json?.result || `خطأ دفترة (${res.status})`);
    throw new Error(message);
  }
  return json;
}

// يتحقق من صحة subdomain/api_key قبل حفظهما
export async function testDaftraConnection(subdomain, apiKey) {
  await daftraFetch({ subdomain, api_key: apiKey }, '/site_info');
}

function mapClientToDaftraPayload(client, settings) {
  const payload = {
    business_name: client.name,
    type: 2, // فرد — لا مفهوم "منشأة" في نموذج عميل ترتيب الحالي
    first_name: client.name,
    is_offline: true, // عملاء ترتيب بلا بريد إلكتروني غالباً
    skip_email: true,
    country_code: settings.default_country_code || 'SA',
    default_currency_code: settings.default_currency_code || 'SAR',
  };
  if (client.phone) payload.phone1 = client.phone;
  if (client.notes) payload.notes = client.notes;
  if (client.code) payload.client_number = client.code;
  return payload;
}

// يدفع عميلاً واحداً من ترتيب إلى دفترة: إنشاء أول مرة، تعديل لاحقاً.
// اتجاه واحد فقط (ترتيب → دفترة)، بلا تأثير على بيانات ترتيب عند الفشل
// غير تسجيل سبب الخطأ على سجل العميل نفسه.
export async function pushClientToDaftra(clientId) {
  const settings = await getDaftraSettings();
  if (!settings?.enabled || !settings?.subdomain || !settings?.api_key) {
    return { skipped: true, reason: 'الربط مع دفترة غير مفعّل' };
  }

  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('id,code,name,phone,notes,daftra_client_id')
    .eq('id', clientId)
    .maybeSingle();
  if (clientError) throw clientError;
  if (!client) throw new Error('العميل غير موجود');

  const payload = mapClientToDaftraPayload(client, settings);

  try {
    let daftraId = client.daftra_client_id;
    if (daftraId) {
      await daftraFetch(settings, `/clients/${daftraId}`, { method: 'PUT', body: { Client: payload } });
    } else {
      const created = await daftraFetch(settings, '/clients', { method: 'POST', body: { Client: payload } });
      daftraId = created?.id;
      if (!daftraId) throw new Error('لم يُرجع دفترة معرّف العميل الجديد');
    }

    await supabaseAdmin.from('clients').update({
      daftra_client_id: daftraId,
      daftra_synced_at: new Date().toISOString(),
      daftra_sync_error: null,
    }).eq('id', clientId);
    await recordSyncResult({ ok: true });
    return { ok: true, daftra_client_id: daftraId };
  } catch (error) {
    const message = error.message || 'تعذّرت المزامنة مع دفترة';
    await supabaseAdmin.from('clients').update({ daftra_sync_error: message }).eq('id', clientId);
    await recordSyncResult({ ok: false, error: message });
    return { ok: false, error: message };
  }
}

// مزامنة دفعية لكل العملاء الذين لم يُزامَنوا بعد (أو الكل عند force)
export async function pushAllClientsToDaftra({ force = false } = {}) {
  const settings = await getDaftraSettings();
  if (!settings?.enabled || !settings?.subdomain || !settings?.api_key) {
    return { skipped: true, reason: 'الربط مع دفترة غير مفعّل' };
  }
  let query = supabaseAdmin.from('clients').select('id').eq('in_crm', true);
  if (!force) query = query.is('daftra_client_id', null);
  const { data: rows, error } = await query;
  if (error) throw error;

  let synced = 0;
  const errors = [];
  for (const row of rows || []) {
    // تسلسلي عمداً لتفادي تجاوز حدود المعدل اليومية لدفترة
    // eslint-disable-next-line no-await-in-loop
    const result = await pushClientToDaftra(row.id);
    if (result.ok) synced += 1;
    else if (!result.skipped) errors.push({ client_id: row.id, error: result.error });
  }
  return { total: rows?.length || 0, synced, errors };
}
