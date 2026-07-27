import { createClient } from 'npm:@supabase/supabase-js@2';

const PRIMARY_ADMIN_EMAIL = 'r.kallajo@gmail.com';

const PERMISSION_GROUPS = [
  ['dashboard', 'settings'],
  ['clients', 'projects', 'cost', 'warehouse', 'warehouse_inventory', 'warehouse_products', 'employees', 'heatmap'],
  ['quotes', 'invoices', 'expenses', 'bank_reconciliation', 'government'],
];

const ALL_PERMISSIONS = PERMISSION_GROUPS.flat();

const ROLE_PRESETS: Record<string, string[]> = {
  admin: ALL_PERMISSIONS,
  manager: ['dashboard', 'clients', 'projects', 'cost', 'warehouse', 'warehouse_inventory', 'warehouse_products', 'employees', 'heatmap', 'quotes', 'invoices', 'expenses'],
  accountant: ['dashboard', 'clients', 'projects', 'cost', 'quotes', 'invoices', 'expenses', 'bank_reconciliation'],
  operations: ['dashboard', 'clients', 'projects', 'cost', 'warehouse', 'warehouse_inventory', 'warehouse_products', 'employees'],
  viewer: ['dashboard', 'clients', 'projects'],
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function apiError(message: string, status = 400) {
  return json({ error: message }, status);
}

function normalizeEmail(email: unknown) {
  return String(email || '').trim().toLowerCase();
}

function isPrimaryAdmin(email: unknown) {
  return normalizeEmail(email) === PRIMARY_ADMIN_EMAIL;
}

function normalizePermissions(permissions: unknown, email = '') {
  if (isPrimaryAdmin(email)) return ALL_PERMISSIONS;
  const allowed = new Set(ALL_PERMISSIONS);
  return [...new Set(Array.isArray(permissions) ? permissions : [])].filter((permission) => (
    typeof permission === 'string' && allowed.has(permission)
  ));
}

function secretKey() {
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (secretKeys) {
    const parsed = JSON.parse(secretKeys);
    if (parsed.default) return parsed.default;
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseAdmin = createClient(supabaseUrl, secretKey(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

function cleanUserPayload(input: Record<string, unknown>) {
  const email = normalizeEmail(input.email);
  const role = String(input.role || 'viewer');
  const rawPermissions = Array.isArray(input.permissions) && input.permissions.length
    ? input.permissions
    : ROLE_PRESETS[role] || [];
  const permissions = role === 'admin' ? ALL_PERMISSIONS : normalizePermissions(rawPermissions, email);
  return {
    email,
    display_name: String(input.display_name || '').trim() || null,
    role: isPrimaryAdmin(email) ? 'admin' : role,
    permissions: isPrimaryAdmin(email) ? ALL_PERMISSIONS : permissions,
    active: isPrimaryAdmin(email) ? true : input.active !== false,
  };
}

async function requireAdmin(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { response: apiError('جلسة الدخول غير موجودة', 401) };

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) return { response: apiError('جلسة الدخول غير صالحة', 401) };

  const email = normalizeEmail(userData.user.email);
  const { data: row, error } = await supabaseAdmin
    .from('app_user_access')
    .select('user_id,email,display_name,role,permissions,active')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (error) return { response: apiError(error.message || 'تعذّر التحقق من الصلاحيات', 500) };

  const primary = isPrimaryAdmin(email);
  const role = primary ? 'admin' : row?.role || 'viewer';
  const active = primary ? true : row?.active === true;
  const canManage = active && (primary || role === 'admin');
  if (!canManage) return { response: apiError('لا تملك صلاحية إدارة المستخدمين', 403) };

  if (primary) {
    await supabaseAdmin.from('app_user_access').upsert({
      user_id: userData.user.id,
      email,
      display_name: row?.display_name || 'رغيد',
      role: 'admin',
      permissions: ALL_PERMISSIONS,
      active: true,
    }, { onConflict: 'user_id' });
  }

  return { user: userData.user };
}

async function findAuthUserByEmail(email: string) {
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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  try {
    if (request.method === 'GET') {
      return json({ users: await listRowsWithAuth() });
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const payload = cleanUserPayload(body);
      if (!payload.email) return apiError('البريد الإلكتروني مطلوب');

      let authUser = body.user_id ? { id: body.user_id, email: payload.email } : await findAuthUserByEmail(payload.email);
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
      } else if (body.password) {
        const { error } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
          password: String(body.password),
          user_metadata: { display_name: payload.display_name || payload.email },
        });
        if (error) throw error;
      }

      const { data, error } = await supabaseAdmin
        .from('app_user_access')
        .upsert({ user_id: authUser.id, ...payload }, { onConflict: 'user_id' })
        .select('user_id,email,display_name,role,permissions,active,created_at,updated_at')
        .single();
      if (error) throw error;
      return json({ user: data });
    }

    if (request.method === 'DELETE') {
      const url = new URL(request.url);
      const userId = url.searchParams.get('user_id');
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
      return json({ user: data });
    }

    return apiError('طريقة الطلب غير مدعومة', 405);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'تعذّر تنفيذ العملية', 500);
  }
});
