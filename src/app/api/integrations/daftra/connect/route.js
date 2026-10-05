import { NextResponse } from 'next/server';
import { apiError, requirePermission } from '../../../_auth';
import { getDaftraSettings, normalizeDaftraSubdomain, saveDaftraSettings, testDaftraConnection } from '@/lib/daftraAdmin';

// يختبر الاتصال بدفترة أولاً (subdomain + api_key صحيحين فعلاً) قبل حفظهما
export async function POST(request) {
  const session = await requirePermission(request, 'settings');
  if (session.response) return session.response;

  const body = await request.json().catch(() => ({}));
  const subdomain = normalizeDaftraSubdomain(body.subdomain);
  if (!subdomain) return apiError('اسم النطاق الفرعي لدفترة مطلوب', 400);

  // تعديل بلا مفتاح جديد (مثلاً تغيير النطاق فقط) يُبقي على المفتاح الحالي
  let apiKey = (body.api_key || '').trim();
  if (!apiKey) {
    const existing = await getDaftraSettings();
    apiKey = existing?.api_key || '';
  }
  if (!apiKey) return apiError('مفتاح API مطلوب', 400);

  try {
    await testDaftraConnection(subdomain, apiKey);
  } catch (error) {
    return apiError(`تعذّر الاتصال بدفترة: ${error.message || 'بيانات غير صحيحة'}`, 400);
  }

  try {
    const settings = await saveDaftraSettings({
      subdomain,
      api_key: apiKey,
      enabled: body.enabled,
      default_country_code: body.default_country_code,
      default_currency_code: body.default_currency_code,
    });
    return NextResponse.json({
      connected: true,
      enabled: settings.enabled,
      subdomain: settings.subdomain,
      default_country_code: settings.default_country_code,
      default_currency_code: settings.default_currency_code,
    });
  } catch (error) {
    return apiError(error.message || 'تعذّر حفظ إعدادات دفترة', 500);
  }
}
