// ============================================================
//  مشغّل مزامنة alostaz.io من جانب العميل (المتصفح) — أفضل جهد فقط
//  لا يوقف أي عملية حفظ في ترتيب إن فشلت أو تأخرت alostaz.io
// ============================================================
import { supabase } from '../supabase';

export async function triggerAlostazSync(path, body) {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    // صامت عمداً — المزامنة الدفعية من الإعدادات تلتقط أي سجل تعذّرت مزامنته
  }
}
