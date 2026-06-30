// عميل Supabase — Tarteeb SaaS App
// القيم تُقرأ من متغيّرات البيئة (.env.local). لا تكتب المفاتيح هنا مباشرة.
import { createClient } from '@supabase/supabase-js';

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anon) {
  console.warn('Supabase env vars missing — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');
}

export const supabase = createClient(url, anon);
