// ============================================================
//  طبقة البيانات · تنظيف ملفات Storage (CRM-AUD-07)
//  جزء من طبقة البيانات — يُعاد تصديره من src/lib/data.js فلا تتغير
//  الاستيرادات في الصفحات.
// ============================================================
import { supabase } from '../supabase';

// حذف السجل أو تبديل ملفه يضع المسار القديم في طابور داخل نفس عملية قاعدة البيانات
// (triggers)، ثم تأخذ هذه الدالة العناصر المستحقة وتحذف ملفاتها. الملف لا يُحذف أبداً
// وهو ما زال مرتبطاً بسجل، والفشل يُعاد لاحقاً بدل أن يُبتلع بصمت.
export async function processStorageCleanup(limit = 20) {
  const { data: items, error } = await supabase.rpc('storage_cleanup_claim', { p_limit: limit });
  if (error) return { done: 0, failed: 0, error: error.message };
  let done = 0; const failures = [];
  for (const item of items || []) {
    const { error: rmErr } = await supabase.storage.from(item.bucket).remove([item.path]);
    await supabase.rpc('storage_cleanup_finish', { p_id: item.id, p_error: rmErr ? rmErr.message || 'remove failed' : null });
    if (rmErr) failures.push(rmErr.message); else done += 1;
  }
  return { done, failed: failures.length, error: failures.join('، ') };
}

// ملف رُفع ثم فشل حفظ سجله: نحاول حذفه فوراً، وإن فشل نضعه في الطابور.
export async function discardUploadedFile(bucket, path) {
  if (!path) return;
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) await supabase.rpc('storage_cleanup_enqueue', { p_bucket: bucket, p_path: path });
}
