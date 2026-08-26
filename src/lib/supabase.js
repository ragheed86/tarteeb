// عميل Supabase — Tarteeb SaaS App
// القيم تُقرأ من متغيّرات البيئة (.env.local). لا تكتب المفاتيح هنا مباشرة.
import { createClient } from '@supabase/supabase-js';

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const missingEnv = !url || !anon;
export const supabaseReady = !missingEnv;

if (missingEnv) {
  console.warn('Supabase env vars missing — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');
}

export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anon || 'placeholder-anon-key'
);

// ذاكرة قصيرة للقراءات المشتركة بين الصفحات. تحتفظ أيضاً بالطلب الجاري كي
// لا ترسل الصفحات المتزامنة الاستعلام نفسه أكثر من مرة.
const readCache = new Map();

export function clearSupabaseReadCache(...keys) {
  if (!keys.length) readCache.clear();
  else keys.forEach((key) => readCache.delete(key));
}

export function cachedSupabaseRead(key, loader, ttlMs = 60_000) {
  const now = Date.now();
  const cached = readCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = Promise.resolve().then(loader).catch((error) => {
    if (readCache.get(key)?.promise === promise) readCache.delete(key);
    throw error;
  });
  readCache.set(key, { promise, expiresAt: now + ttlMs });
  return promise;
}
