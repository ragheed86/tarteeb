import { NextResponse } from 'next/server';
import { requirePermission } from '../../../_auth';
import { getAlostazSettings } from '@/lib/alostazAdmin';

// لا يُرجع token إطلاقاً — فقط حالة الربط وما يلزم لعرضه في الإعدادات
export async function GET(request) {
  const session = await requirePermission(request, 'settings');
  if (session.response) return session.response;
  try {
    const settings = await getAlostazSettings();
    return NextResponse.json({
      connected: !!(settings?.base_url && settings?.token),
      enabled: !!settings?.enabled,
      base_url: settings?.base_url || '',
      branch_id: settings?.branch_id || '',
      api_version: settings?.api_version || '',
      locale: settings?.locale || 'ar',
      default_treasury_id: settings?.default_treasury_id || '',
      default_product_id: settings?.default_product_id || '',
      default_storehouse_id: settings?.default_storehouse_id || '',
      last_sync_at: settings?.last_sync_at || null,
      last_sync_error: settings?.last_sync_error || null,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'تعذّر جلب حالة الربط' }, { status: 500 });
  }
}
