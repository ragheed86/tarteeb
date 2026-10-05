import { NextResponse } from 'next/server';
import { requirePermission } from '../../../_auth';
import { getDaftraSettings } from '@/lib/daftraAdmin';

// لا يُرجع api_key إطلاقاً — فقط حالة الربط وما يلزم لعرضه في الإعدادات
export async function GET(request) {
  const session = await requirePermission(request, 'settings');
  if (session.response) return session.response;
  try {
    const settings = await getDaftraSettings();
    return NextResponse.json({
      connected: !!(settings?.subdomain && settings?.api_key),
      enabled: !!settings?.enabled,
      subdomain: settings?.subdomain || '',
      default_country_code: settings?.default_country_code || 'SA',
      default_currency_code: settings?.default_currency_code || 'SAR',
      last_sync_at: settings?.last_sync_at || null,
      last_sync_error: settings?.last_sync_error || null,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'تعذّر جلب حالة الربط' }, { status: 500 });
  }
}
