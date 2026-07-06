'use client';
import { useEffect, useRef, useState } from 'react';

// useState عادي لكنه يُخزَّن في sessionStorage — يبقى حياً عبر إعادة تركيب المكوّن
// (مثلاً عند رجوع Splash بسبب حدث مصادقة) وحتى عبر إعادة تحميل حقيقية لنفس التبويب،
// لكنه يُمسَح عند إغلاق التبويب فعلياً (خلافاً لـlocalStorage الذي يبقى للأبد).
export function usePersistedState(key, initialValue) {
  const first = useRef(true);
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined') return initialValue;
    try {
      const raw = sessionStorage.getItem(key);
      return raw !== null ? JSON.parse(raw) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {}
  }, [key, value]);

  return [value, setValue];
}
