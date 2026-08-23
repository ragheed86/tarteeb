const { test, expect } = require('@playwright/test');

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('حدود الأمان العامة', () => {
  test('التقرير المالي المحذوف غير متاح', async ({ request }) => {
    const response = await request.get('/reports/khawla-expense-report.html');
    expect(response.status()).toBe(404);
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
