// إدارة المستخدمين — المسار الأساسي (canonical) عند توفّر SUPABASE_SERVICE_ROLE_KEY.
// Edge Function (supabase/functions/admin-users) يُستخدم كبديل فقط حين لا يكون
// المفتاح متاحًا في بيئة Next. للتخلص من الازدواج نهائيًا يُوصى باعتماد هذا المسار
// وإزالة البديل بعد تأكيد أن الإنتاج يضبط المفتاح (متابعة موثّقة).
// idempotency: إنشاء المستخدم يبحث أولًا عن حساب موجود بالبريد، وعند فشل إنشاء صف
// الصلاحيات بعد إنشاء حساب جديد يُحذف الحساب تعويضيًا كي لا يبقى معلّقًا.
import { NextResponse } from 'next/server';
import { supabaseAdmin, supabaseAdminReady } from '@/lib/supabaseAdmin';
import {
  ALL_PERMISSIONS, ROLE_PRESETS, isPrimaryAdmin, normalizeEmail, normalizePermissions,
} from '@/lib/permissions';
import { apiError, requireAdmin } from '../../_auth';
import { enforceRateLimit } from '../../_rateLimit';

async function proxyToSupabaseAdminUsers(request) {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!baseUrl) return apiError('إعدادات Supabase غير مكتملة', 500);

  const source = new URL(request.url);
  const target = new URL('/functions/v1/admin-users', baseUrl);
  target.search = source.search;

  const headers = {
    Authorization: request.headers.get('authorization') || '',
  };
  const contentType = request.headers.get('content-type');
  if (contentType) headers['Content-Type'] = contentType;

  const res = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === 'GET' ? undefined : await request.text(),
    cache: 'no-store',
  });
  const payload = await res.json().catch(() => ({}));
  return NextResponse.json(payload, { status: res.status });
}

function cleanUserPayload(input) {
  const email = normalizeEmail(input.email);
  const role = input.role || 'viewer';
  const permissions = role === 'admin'
    ? ALL_PERMISSIONS
    : normalizePermissions(input.permissions?.length ? input.permissions : ROLE_PRESETS[role] || [], email);
  return {
    email,
    display_name: String(input.display_name || '').trim() || null,
    role: isPrimaryAdmin(email) ? 'admin' : role,
    permissions: isPrimaryAdmin(email) ? ALL_PERMISSIONS : permissions,
    active: isPrimaryAdmin(email) ? true : input.active !== false,
  };
}

async function findAuthUserByEmail(email) {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return (data?.users || []).find((user) => normalizeEmail(user.email) === email) || null;
}

async function listRowsWithAuth() {
  const [{ data: rows, error: rowsError }, { data: authData, error: authError }] = await Promise.all([
    supabaseAdmin
      .from('app_user_access')
      .select('user_id,email,display_name,role,permissions,active,created_at,updated_at')
      .order('created_at', { ascending: false }),
    supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  if (rowsError) throw rowsError;
  if (authError) throw authError;
  const byId = Object.fromEntries((authData?.users || []).map((user) => [user.id, user]));
  return (rows || []).map((row) => ({
    ...row,
    auth_email: byId[row.user_id]?.email || row.email,
    last_sign_in_at: byId[row.user_id]?.last_sign_in_at || null,
    email_confirmed_at: byId[row.user_id]?.email_confirmed_at || null,
  }));
}

export async function GET(request) {
  const limited = enforceRateLimit(request, { scope: 'admin-users-read', limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  if (!supabaseAdminReady) return proxyToSupabaseAdminUsers(request);
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;
  try {
    const users = await listRowsWithAuth();
    return NextResponse.json({ users });
  } catch (error) {
    console.error('admin/users GET failed:', error);
    return apiError('تعذّر تحميل المستخدمين', 500);
  }
}

export async function POST(request) {
  // حد أشد على الكتابة (إنشاء/تعديل مستخدمين) لتقليل خطر الإساءة.
  const limited = enforceRateLimit(request, { scope: 'admin-users-write', limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  if (!supabaseAdminReady) return proxyToSupabaseAdminUsers(request);
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;
  try {
    const body = await request.json();
    const payload = cleanUserPayload(body);
    if (!payload.email) return apiError('البريد الإلكتروني مطلوب');

    let authUser = body.user_id ? { id: body.user_id, email: payload.email } : await findAuthUserByEmail(payload.email);
    let createdAuthUser = false;
    if (!authUser) {
      const password = String(body.password || '').trim();
      if (password.length < 6) return apiError('كلمة المرور مطلوبة ويجب ألا تقل عن 6 أحرف');
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: payload.email,
        password,
        email_confirm: true,
        user_metadata: { display_name: payload.display_name || payload.email },
      });
      if (error) throw error;
      authUser = data.user;
      createdAuthUser = true;
    } else if (body.password) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
        password: String(body.password),
        user_metadata: { display_name: payload.display_name || payload.email },
      });
      if (error) throw error;
    }

    const row = {
      user_id: authUser.id,
      ...payload,
    };
    const { data, error } = await supabaseAdmin
      .from('app_user_access')
      .upsert(row, { onConflict: 'user_id' })
      .select('user_id,email,display_name,role,permissions,active,created_at,updated_at')
      .single();
    if (error) {
      // تعويض: لو أنشأنا مستخدم مصادقة جديدًا للتو ثم فشل إنشاء صف الصلاحيات،
      // نحذف المستخدم كي لا يبقى معلّقًا بلا صلاحيات (idempotency).
      if (createdAuthUser) {
        await supabaseAdmin.auth.admin.deleteUser(authUser.id).catch(() => {});
      }
      throw error;
    }
    return NextResponse.json({ user: data });
  } catch (error) {
    console.error('admin/users POST failed:', error);
    return apiError('تعذّر حفظ المستخدم', 500);
  }
}

export async function DELETE(request) {
  const limited = enforceRateLimit(request, { scope: 'admin-users-write', limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  if (!supabaseAdminReady) return proxyToSupabaseAdminUsers(request);
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');
    if (!userId) return apiError('معرّف المستخدم مطلوب');
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('app_user_access')
      .select('email')
      .eq('user_id', userId)
      .single();
    if (existingError) throw existingError;
    if (isPrimaryAdmin(existing.email)) return apiError('لا يمكن تعطيل الأدمن الأساسي', 403);
    const { data, error } = await supabaseAdmin
      .from('app_user_access')
      .update({ active: false })
      .eq('user_id', userId)
      .select('user_id,email,display_name,role,permissions,active,created_at,updated_at')
      .single();
    if (error) throw error;
    return NextResponse.json({ user: data });
  } catch (error) {
    console.error('admin/users DELETE failed:', error);
    return apiError('تعذّر تعطيل المستخدم', 500);
  }
}
