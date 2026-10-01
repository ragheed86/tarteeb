// تكامل Google Calendar — سيرفر فقط (يُستورد حصراً من src/app/api/**)، يحمل أسرار OAuth
// ولا يجوز استيراده من أي مكوّن 'use client'. مزامنة أحادية الاتجاه: ترتيب → Google، بلا قراءة عكسية.
import crypto from 'node:crypto';
import { supabaseAdmin } from './supabaseAdmin';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
export const googleCalendarReady = Boolean(CLIENT_ID && CLIENT_SECRET);

const SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/calendar/v3';

// ---------- OAuth state (CRM-AUD-01) ----------
// state عشوائي لمرة واحدة، مربوط بالمستخدم البادئ وبكوكي في متصفحه، مع PKCE.
// نخزّن hash للـ state وللكوكي فقط؛ تسريب الجدول لا يكفي لإكمال ربط.
export const OAUTH_STATE_TTL_SECONDS = 600;
export const OAUTH_BROWSER_COOKIE = 'gcal_oauth_nonce';
const randomToken = () => crypto.randomBytes(32).toString('base64url');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('base64url');

export async function createOAuthState({ employeeId, userId }) {
  const { data: employee, error: empErr } = await supabaseAdmin.from('employees').select('id').eq('id', employeeId).maybeSingle();
  if (empErr) throw empErr;
  if (!employee) throw new Error('الموظف غير موجود');
  const state = randomToken();
  const browserNonce = randomToken();
  const codeVerifier = randomToken();
  // تنظيف المحاولات المنتهية قبل الإضافة — الجدول يبقى صغيراً
  await supabaseAdmin.from('google_oauth_states').delete().lt('expires_at', new Date().toISOString());
  const { error } = await supabaseAdmin.from('google_oauth_states').insert({
    state_hash: sha256(state),
    browser_hash: sha256(browserNonce),
    employee_id: employeeId,
    user_id: userId,
    code_verifier: codeVerifier,
    expires_at: new Date(Date.now() + OAUTH_STATE_TTL_SECONDS * 1000).toISOString(),
  });
  if (error) throw error;
  return { state, browserNonce, codeChallenge: sha256(codeVerifier) };
}

// استهلاك ذرّي: UPDATE واحد بشرط used_at is null — طلبان متزامنان لنفس state، واحد فقط ينجح.
export async function consumeOAuthState({ state, browserNonce }) {
  if (!state || !browserNonce) return null;
  const { data, error } = await supabaseAdmin.from('google_oauth_states')
    .update({ used_at: new Date().toISOString() })
    .eq('state_hash', sha256(state))
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('employee_id,user_id,code_verifier,browser_hash');
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  // مقارنة بزمن ثابت لكوكي المتصفح البادئ
  const expected = Buffer.from(row.browser_hash);
  const actual = Buffer.from(sha256(browserNonce));
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  return { employeeId: row.employee_id, userId: row.user_id, codeVerifier: row.code_verifier };
}

export function buildAuthUrl({ state, codeChallenge, redirectUri }) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode({ code, redirectUri, codeVerifier }) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: codeVerifier,
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error_description || payload.error || 'تعذّر إتمام الربط مع Google');
  return payload; // { access_token, refresh_token, expires_in, ... }
}

async function fetchGoogleProfile(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

export async function connectEmployeeCalendar({ employeeId, code, redirectUri, connectedBy, codeVerifier }) {
  const tokens = await exchangeCode({ code, redirectUri, codeVerifier });
  if (!tokens.refresh_token) {
    throw new Error('لم توافق Google على منح صلاحية دائمة — أعد المحاولة واختر «السماح» عند الطلب');
  }
  const profile = await fetchGoogleProfile(tokens.access_token);
  const expiresAt = new Date(Date.now() + (Number(tokens.expires_in) || 3600) * 1000).toISOString();
  const { error } = await supabaseAdmin.from('employee_calendar_connections').upsert({
    employee_id: employeeId,
    google_email: profile?.email || null,
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    access_token_expires_at: expiresAt,
    connected_by: connectedBy || null,
  }, { onConflict: 'employee_id' });
  if (error) throw error;
}

export async function disconnectEmployeeCalendar(employeeId) {
  const { error } = await supabaseAdmin.from('employee_calendar_connections').delete().eq('employee_id', employeeId);
  if (error) throw error;
}

export async function getEmployeeCalendarConnections() {
  const { data, error } = await supabaseAdmin
    .from('employee_calendar_connections')
    .select('employee_id,google_email,calendar_id,created_at');
  if (error) throw error;
  return data;
}

async function getConnection(employeeId) {
  const { data, error } = await supabaseAdmin
    .from('employee_calendar_connections')
    .select('*').eq('employee_id', employeeId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getValidAccessToken(employeeId) {
  const conn = await getConnection(employeeId);
  if (!conn) return null;
  const expiresAt = conn.access_token_expires_at ? new Date(conn.access_token_expires_at).getTime() : 0;
  if (conn.access_token && expiresAt - Date.now() > 60_000) return conn;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: conn.refresh_token, grant_type: 'refresh_token',
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    // رفض جوجل للتوكن (مثلاً ألغى الموظف الصلاحية من حسابه) — نحذف الاتصال بدل تكرار المحاولة الفاشلة
    if (payload.error === 'invalid_grant') await supabaseAdmin.from('employee_calendar_connections').delete().eq('employee_id', employeeId);
    throw new Error(payload.error_description || payload.error || 'تعذّر تجديد الاتصال بتقويم Google');
  }
  const accessTokenExpiresAt = new Date(Date.now() + (Number(payload.expires_in) || 3600) * 1000).toISOString();
  const { data: updated, error } = await supabaseAdmin
    .from('employee_calendar_connections')
    .update({ access_token: payload.access_token, access_token_expires_at: accessTokenExpiresAt })
    .eq('employee_id', employeeId).select('*').single();
  if (error) throw error;
  return updated;
}

function toGoogleEvent(appointment) {
  if (appointment.all_day) {
    const startDate = appointment.starts_at.slice(0, 10);
    const endExclusive = new Date(new Date(appointment.ends_at.slice(0, 10)).getTime() + 86400000).toISOString().slice(0, 10);
    return {
      summary: appointment.title,
      description: appointment.description || undefined,
      location: appointment.location || undefined,
      start: { date: startDate },
      end: { date: endExclusive },
    };
  }
  return {
    summary: appointment.title,
    description: appointment.description || undefined,
    location: appointment.location || undefined,
    start: { dateTime: appointment.starts_at },
    end: { dateTime: appointment.ends_at },
  };
}

// ينشئ أو يحدّث حدث تقويم الموظف بحيث يطابق الموعد — يرمي فقط عند فشل حقيقي لموظف متصل
export async function upsertGoogleEvent({ employeeId, appointment }) {
  const conn = await getValidAccessToken(employeeId);
  if (!conn) return { synced: false, reason: 'not_connected' };

  const { data: existing } = await supabaseAdmin
    .from('appointment_calendar_events')
    .select('google_event_id').eq('appointment_id', appointment.id).eq('employee_id', employeeId).maybeSingle();

  const body = toGoogleEvent(appointment);
  const calendarId = encodeURIComponent(conn.calendar_id || 'primary');
  const url = existing?.google_event_id
    ? `${API_BASE}/calendars/${calendarId}/events/${existing.google_event_id}`
    : `${API_BASE}/calendars/${calendarId}/events`;
  const res = await fetch(url, {
    method: existing?.google_event_id ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${conn.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error?.message || 'تعذّر مزامنة الموعد مع تقويم Google');

  await supabaseAdmin.from('appointment_calendar_events').upsert({
    appointment_id: appointment.id, employee_id: employeeId, google_event_id: payload.id, synced_at: new Date().toISOString(),
  }, { onConflict: 'appointment_id,employee_id' });
  return { synced: true };
}

export async function deleteGoogleEvent({ employeeId, appointmentId }) {
  const { data: existing } = await supabaseAdmin
    .from('appointment_calendar_events')
    .select('google_event_id').eq('appointment_id', appointmentId).eq('employee_id', employeeId).maybeSingle();
  if (!existing) return;
  const conn = await getValidAccessToken(employeeId).catch(() => null);
  if (conn) {
    const calendarId = encodeURIComponent(conn.calendar_id || 'primary');
    await fetch(`${API_BASE}/calendars/${calendarId}/events/${existing.google_event_id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${conn.access_token}` },
    }).catch(() => {});
  }
  await supabaseAdmin.from('appointment_calendar_events')
    .delete().eq('appointment_id', appointmentId).eq('employee_id', employeeId);
}

// يزامن موعداً كاملاً مع كل حاضريه الحاليين، ويحذف حدث أي موظف أُزيل من قائمة الحضور
export async function syncAppointment(appointmentId) {
  const { data: appointment, error: apptError } = await supabaseAdmin
    .from('appointments').select('*').eq('id', appointmentId).single();
  if (apptError) throw apptError;

  const [{ data: attendees, error: attError }, { data: syncedRows, error: syncError }] = await Promise.all([
    supabaseAdmin.from('appointment_attendees').select('employee_id').eq('appointment_id', appointmentId),
    supabaseAdmin.from('appointment_calendar_events').select('employee_id').eq('appointment_id', appointmentId),
  ]);
  if (attError) throw attError;
  if (syncError) throw syncError;

  const attendeeIds = new Set((attendees || []).map((a) => a.employee_id));
  const previouslySynced = new Set((syncedRows || []).map((r) => r.employee_id));
  const results = {};

  for (const employeeId of attendeeIds) {
    try { results[employeeId] = await upsertGoogleEvent({ employeeId, appointment }); }
    catch (e) { results[employeeId] = { synced: false, reason: e.message }; }
  }
  for (const employeeId of previouslySynced) {
    if (!attendeeIds.has(employeeId)) await deleteGoogleEvent({ employeeId, appointmentId }).catch(() => {});
  }
  return results;
}

// يحذف كل أحداث Google المرتبطة بموعد (يُستدعى قبل حذف الموعد نفسه)
export async function deleteAppointmentSync(appointmentId) {
  const { data: syncedRows, error } = await supabaseAdmin
    .from('appointment_calendar_events').select('employee_id').eq('appointment_id', appointmentId);
  if (error) throw error;
  for (const row of syncedRows || []) {
    await deleteGoogleEvent({ employeeId: row.employee_id, appointmentId }).catch(() => {});
  }
}
