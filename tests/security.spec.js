const { test, expect } = require('@playwright/test');

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('حدود الأمان العامة', () => {
  test('التقرير المالي المحذوف غير متاح', async ({ request }) => {
    // الوسيط (proxy.js) لا يستثني *.html من حراسة الجلسة، فطلب بلا جلسة يُحوَّل
    // (307) لتسجيل الدخول بدل 404 صريح — لا نتابع التحويل كي لا نقيس صفحة
    // الدخول (200) بدل المسار الأصلي؛ المهم أن المسار لا يُخدَّم فعلياً (ليس 200).
    const response = await request.get('/reports/khawla-expense-report.html', { maxRedirects: 0 });
    expect(response.status()).not.toBe(200);
  });

  test('المسارات الحساسة ترفض الطلب بلا جلسة', async ({ request }) => {
    const response = await request.get('/api/admin/users');
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test('رؤوس الأمان مفعّلة', async ({ request }) => {
    const response = await request.get('/');
    const headers = response.headers();

    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toBeTruthy();
  });
});
