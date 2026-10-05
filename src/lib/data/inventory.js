// ============================================================
//  طبقة البيانات · المستودع (أصناف، مستودعات، تصنيفات، صور المنتج)
//  جزء من طبقة البيانات — يُعاد تصديره من src/lib/data.js فلا تتغير
//  الاستيرادات في الصفحات.
// ============================================================
import { supabase } from '../supabase';
import { discardUploadedFile, processStorageCleanup } from './storage';

export async function getInventory() {
  const { data, error } = await supabase.from('inventory_items')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error; return data;
}
export async function getWarehouses() { const { data, error } = await supabase.from('warehouses').select('*'); if (error) throw error; return data; }
export async function getCategories() { const { data, error } = await supabase.from('categories').select('*'); if (error) throw error; return data; }

// المنتجات الأكثر طلباً: تُجمَّع من مواد تكاليف المشاريع (kind=materials) حسب اسم المنتج
export async function getProductDemand() {
  const { data, error } = await supabase.from('project_costs')
    .select('product_name, qty, project_id')
    .eq('kind', 'materials')
    .not('product_name', 'is', null);
  if (error) throw error;
  const map = new Map();
  for (const r of data || []) {
    const name = (r.product_name || '').trim();
    if (!name) continue;
    const cur = map.get(name) || { name, qty: 0, times: 0, projects: new Set() };
    cur.qty += Number(r.qty) || 0;
    cur.times += 1;
    if (r.project_id) cur.projects.add(r.project_id);
    map.set(name, cur);
  }
  return [...map.values()]
    .map((x) => ({ name: x.name, qty: x.qty, times: x.times, projects: x.projects.size }))
    .sort((a, b) => b.qty - a.qty || b.times - a.times);
}

export async function createInventoryItem(p) {
  const { data, error } = await supabase.from('inventory_items').insert(p).select('*').single();
  if (error) throw error; return data;
}
export async function updateInventoryItem(id, p) {
  const { data, error } = await supabase.from('inventory_items').update(p).eq('id', id).select('*').single();
  if (error) throw error;
  if ('image_path' in p) processStorageCleanup().catch(() => {});
  return data;
}
export async function removeInventoryItem(id) {
  const { error } = await supabase.from('inventory_items').delete().eq('id', id);
  if (error) throw error;
  await processStorageCleanup();
}

// يرفع صورة المنتج إلى حاوية التخزين العامة ويعيد الرابط والمسار
const PRODUCT_IMAGES_BUCKET = 'product-images';
export async function uploadProductImage(file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined });
  if (upErr) throw upErr;
  const { data: pub } = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(path);
  return { url: pub.publicUrl, path };
}
// لصورة رُفعت ولم تُحفظ في سجل المنتج. استبدال صورة محفوظة يتم عبر طابور التنظيف.
export async function removeProductImage(path) {
  await discardUploadedFile(PRODUCT_IMAGES_BUCKET, path);
}
