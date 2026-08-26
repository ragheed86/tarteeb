'use client';
import { useEffect, useState } from 'react';
import { clearSupabaseReadCache, supabase, supabaseReady } from '@/lib/supabase';
import { ALL_PERMISSIONS, isPrimaryAdmin, normalizePermissions } from '@/lib/permissions';

// يحمّل الجلسة وصلاحيات المستخدم مرة واحدة ويشاركهما بين AppShell وأي صفحة تحتاجهما
// (كانت هذه المنطق مكرّرة سابقاً في AppShell.jsx وwarehouse/page.js بشكل منفصل).
// session: undefined=يحمّل، null=خارج، كائن=داخل. access نفس النمط.
export function useAccess() {
  const [session, setSession] = useState(undefined);
  const [access, setAccess] = useState(undefined);

  useEffect(() => {
    if (!supabaseReady) {
      setSession(null);
      return undefined;
    }
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    // TOKEN_REFRESHED يتكرر تلقائياً عند عودة التبويب من الخلفية (Supabase يراقب visibilitychange).
    // لا يعني تغيّر هوية المستخدم، فتحديث الجلسة يمرّ بصمت دون إعادة إظهار شاشة التحميل
    // أو إعادة جلب الصلاحيات وفقدان حالة الصفحة الحالية.
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        clearSupabaseReadCache();
      }
      if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        setSession((current) => (current?.user?.id === s?.user?.id ? { ...current, ...s } : s));
        return;
      }
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadAccess() {
      if (!session) {
        setAccess(session === null ? null : undefined);
        return;
      }
      // لو الصلاحيات محمّلة مسبقاً لنفس المستخدم أبقِها ظاهرة أثناء التحديث الصامت
      setAccess((current) => (current && current.user_id === session.user.id ? current : undefined));
      const email = session.user?.email || '';
      try {
        const { data, error } = await supabase
          .from('app_user_access')
          .select('user_id,email,display_name,role,permissions,active')
          .eq('user_id', session.user.id)
          .maybeSingle();
        if (error) throw error;
        const primary = isPrimaryAdmin(email);
        if (!cancelled) {
          setAccess({
            user_id: session.user.id,
            email,
            display_name: data?.display_name || '',
            role: primary ? 'admin' : data?.role || 'viewer',
            permissions: primary ? ALL_PERMISSIONS : normalizePermissions(data?.permissions || [], email),
            active: primary ? true : data?.active === true,
            isPrimaryAdmin: primary,
          });
        }
      } catch {
        if (!cancelled) {
          setAccess(isPrimaryAdmin(email)
            ? { user_id: session.user.id, email, role: 'admin', permissions: ALL_PERMISSIONS, active: true, isPrimaryAdmin: true }
            : null);
        }
      }
    }
    loadAccess();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session === undefined ? undefined : session?.user?.id ?? null]);

  return { session, access };
}
