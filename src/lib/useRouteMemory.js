'use client';
import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const KEY = 'tarteeb-last-route';
const REDIRECT_GUARD = 'tarteeb-route-restored';
const MAX_AGE_MS = 6 * 60 * 60 * 1000; // لا تُستعاد مسارات أقدم من 6 ساعات

// يحفظ آخر مسار تصفّحه المستخدم ويستعيده تلقائياً عند إطلاق بارد على الشاشة الرئيسية
// (start_url من manifest.js) — الحالة التي تحدث حين يُغلق نظام التشغيل عملية تطبيق PWA
// المثبّت في الخلفية بسبب ضغط الذاكرة، إذ لا يوجد Service Worker يمنع هذا الإطلاق البارد.
export function useRouteMemory(enabled) {
  const router = useRouter();
  const pathname = usePathname();
  const restored = useRef(false);

  useEffect(() => {
    if (!enabled || restored.current) return;
    restored.current = true;
    try {
      if (window.location.pathname !== '/') return;
      if (sessionStorage.getItem(REDIRECT_GUARD)) return;
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const { path, savedAt } = JSON.parse(raw);
      if (!path || path === '/' || Date.now() - savedAt > MAX_AGE_MS) return;
      sessionStorage.setItem(REDIRECT_GUARD, '1');
      router.replace(path);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !pathname) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ path: pathname + window.location.search, savedAt: Date.now() }));
    } catch {}
  }, [enabled, pathname]);
}
