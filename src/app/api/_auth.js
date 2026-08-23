import { NextResponse } from 'next/server';
import { supabaseAdmin, supabaseAdminReady } from '@/lib/supabaseAdmin';
import {
  ALL_PERMISSIONS, ROLE_PRESETS, canAccess, isPrimaryAdmin, normalizeEmail, normalizePermissions,
} from '@/lib/permissions';

export function apiError(message, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function missingAdminClient() {
  if (supabaseAdminReady) return null;
  return apiError('إعدادات سيرفر الصلاحيات غير مكتملة', 500);
}

export async function getSessionUser(request) {
  const notReady = missingAdminClient();
  if (notReady) return { response: notReady };
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { response: apiError('جلسة الدخول غير موجودة', 401) };
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return { response: apiError('جلسة الدخول غير صالحة', 401) };
  return { user: data.user };
}

function accessFromRow(row, user) {
  const email = normalizeEmail(row?.email || user?.email);
  const primary = isPrimaryAdmin(email);
  const role = primary ? 'admin' : row?.role || 'viewer';
  return {
    user_id: user?.id || row?.user_id || null,
    email,
    display_name: row?.display_name || '',
    role,
    permissions: primary ? ALL_PERMISSIONS : normalizePermissions(row?.permissions || ROLE_PRESETS[role] || [], email),
    active: primary ? true : row?.active === true,
    isPrimaryAdmin: primary,
  };
}

export async function getAccessForUser(user) {
  const email = normalizeEmail(user?.email);
  if (!user || !email) return null;
  const { data, error } = await supabaseAdmin
    .from('app_user_access')
    .select('user_id,email,display_name,role,permissions,active,created_at,updated_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error && error.code !== '42P01') throw error;
  if (isPrimaryAdmin(email)) {
    const row = accessFromRow(data, user);
    await supabaseAdmin.from('app_user_access').upsert({
      user_id: user.id,
      email,
      display_name: data?.display_name || 'رغيد',
      role: 'admin',
      permissions: ALL_PERMISSIONS,
      active: true,
    }, { onConflict: 'user_id' });
    return row;
  }
  return accessFromRow(data, user);
}

export async function requireAdmin(request) {
  const session = await getSessionUser(request);
  if (session.response) return session;
  try {
    const access = await getAccessForUser(session.user);
    if (!canAccess(access, 'settings') || access.role !== 'admin') {
      return { response: apiError('لا تملك صلاحية إدارة المستخدمين', 403) };
    }
    return { user: session.user, access };
  } catch (error) {
    return { response: apiError(error.message || 'تعذّر التحقق من الصلاحيات', 500) };
  }
}
