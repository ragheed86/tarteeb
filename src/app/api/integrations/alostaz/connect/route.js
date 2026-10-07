import { NextResponse } from 'next/server';
import { apiError, requirePermission } from '../../../_auth';
import { getAlostazSettings, saveAlostazSettings, testAlostazConnection } from '@/lib/alostazAdmin';

// يختبر الاتصال بـalostaz.io أولاً (base_url/token/branch_id صحيحين فعلاً) قبل حفظها
export async function POST(request) {
  const session = await requirePermission(request, 'settings');
  if (session.response) return session.response;

  const body = await request.json().catch(() => ({}));
  const baseUrl = (body.base_url || '').trim().replace(/\/+$/, '');
  if (!baseUrl) return apiError('رابط API الأساسي مطلوب', 400);
  const branchId = (body.branch_id || '').trim();
  if (!branchId) return apiError('معرّف الفرع (Branch Id) مطلوب', 400);
  const apiVersion = (body.api_version || '').trim();
  if (!apiVersion) return apiError('إصدار API مطلوب', 400);

  // تعديل بلا رمز جديد (مثلاً تغيير الفرع فقط) يُبقي على الرمز الحالي
  let token = (body.token || '').trim();
  if (!token) {
    const existing = await getAlostazSettings();
    token = existing?.token || '';
  }
  if (!token) return apiError('رمز الدخول (Token) مطلوب', 400);

  const candidate = {
    base_url: baseUrl, token, branch_id: branchId, api_version: apiVersion, locale: body.locale || 'ar',
  };
  try {
    await testAlostazConnection(candidate);
  } catch (error) {
    return apiError(`تعذّر الاتصال بـalostaz.io: ${error.message || 'بيانات غير صحيحة'}`, 400);
  }

  try {
    const settings = await saveAlostazSettings({
      base_url: baseUrl,
      token,
      branch_id: branchId,
      api_version: apiVersion,
      locale: body.locale,
      default_treasury_id: body.default_treasury_id,
      default_product_id: body.default_product_id,
      default_storehouse_id: body.default_storehouse_id,
      enabled: body.enabled,
    });
    return NextResponse.json({
      connected: true,
      enabled: settings.enabled,
      base_url: settings.base_url,
      branch_id: settings.branch_id,
      api_version: settings.api_version,
      locale: settings.locale,
      default_treasury_id: settings.default_treasury_id,
      default_product_id: settings.default_product_id,
      default_storehouse_id: settings.default_storehouse_id,
    });
  } catch (error) {
    return apiError(error.message || 'تعذّر حفظ إعدادات alostaz.io', 500);
  }
}
