// ============================================================
//  طبقة البيانات · التقارير والمؤشرات المجمَّعة
//  جزء من طبقة البيانات — يُعاد تصديره من src/lib/data.js فلا تتغير
//  الاستيرادات في الصفحات.
// ============================================================
import { supabase } from '../supabase';

// مؤشّرات لوحة التحكم لفترة محدَّدة — صفّ واحد مجمَّع في Postgres بدل 9 استعلامات
// تجلب جداول كاملة وتُجمَّع في JavaScript (تدقيق H-3).
export async function getDashboardMetrics(from, to) {
  const { data, error } = await supabase.rpc('dashboard_metrics', { p_from: from, p_to: to });
  if (error) throw error;
  return data;
}

// كل بنود التكلفة لكل المشاريع دفعة واحدة — لحساب الربح الإجمالي بلوحة التحكم
export async function getAllProjectCosts() {
  const { data, error } = await supabase.from('project_costs')
    .select('project_id,amount,work_date,created_at,kind,label,note,product_name,sale_price,markup_percent,worker_type');
  if (error) throw error; return data;
}
// تكاليف مفصّلة لكل المشاريع — لتقارير التصدير (تفريق الخدمة عن المنظمات/المواد)
export async function getAllProjectCostsDetailed() {
  const { data, error } = await supabase.from('project_costs')
    .select('project_id,kind,amount,sale_price,markup_percent');
  if (error) throw error; return data;
}
