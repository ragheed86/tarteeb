// يولّد جلسة اختبار دون أي كلمة مرور:
// يتطلب SUPABASE_SERVICE_ROLE_KEY في .env.local — يولّد magiclink عبر admin API
// ثم يحوّله لجلسة عبر verifyOtp ويحفظها كـ storageState لـ Playwright.
// عند غياب المفتاح: يكتب حالة فارغة وتتخطى الاختبارات المصادَقة نفسها بوضوح.
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');

const TEST_EMAIL = process.env.PW_TEST_EMAIL || 'r.kallajo@gmail.com';

function readEnvLocal() {
  try {
    const raw = readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
    return Object.fromEntries(
      raw.split(/\r?\n/)
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
    );
  } catch { return {}; }
}

module.exports = async function globalSetup() {
  const outDir = path.join(__dirname, '..', 'playwright', '.auth');
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'user.json');
  const env = { ...readEnvLocal(), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  const emptyState = { cookies: [], origins: [] };
  if (!url || !anonKey || !serviceKey) {
    console.warn('[auth.setup] SUPABASE_SERVICE_ROLE_KEY غير متوفر — ستُتخطى الاختبارات المصادَقة. أضِفه إلى .env.local لتفعيلها.');
    writeFileSync(outFile, JSON.stringify(emptyState));
    return;
  }

  const { createClient } = require('@supabase/supabase-js');
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });

  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: TEST_EMAIL });
  if (error) throw new Error(`generateLink: ${error.message}`);
  const tokenHash = data.properties?.hashed_token;
  const { data: verified, error: e2 } = await anon.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  if (e2) throw new Error(`verifyOtp: ${e2.message}`);

  const ref = new URL(url).hostname.split('.')[0];
  const storageKey = `sb-${ref}-auth-token`;
  const baseURL = env.PW_BASE_URL || 'http://localhost:3002';
  writeFileSync(outFile, JSON.stringify({
    cookies: [],
    origins: [{
      origin: baseURL,
      localStorage: [{ name: storageKey, value: JSON.stringify(verified.session) }],
    }],
  }));
  console.log('[auth.setup] جلسة اختبار جاهزة لـ', TEST_EMAIL);
};
