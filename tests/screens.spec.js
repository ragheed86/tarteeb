// لقطات مرجعية للمسارات (باسم المسار × المقاس) للمقارنة البصرية بين الإصدارات.
// أول تشغيل يولّد الأساس: npx playwright test screens --update-snapshots
const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROUTES = ['/', '/clients', '/projects', '/warehouse', '/invoices', '/quotes', '/settings'];

function hasAuthState() {
  try {
    const state = JSON.parse(readFileSync(path.join(__dirname, '..', 'playwright', '.auth', 'user.json'), 'utf8'));
    return (state.origins || []).length > 0;
  } catch { return false; }
}

test.describe('لقطات مرجعية', () => {
  test.skip(!hasAuthState(), 'لا جلسة اختبار — أضف SUPABASE_SERVICE_ROLE_KEY إلى .env.local');

  for (const route of ROUTES) {
    test(`لقطة ${route}`, async ({ page }, testInfo) => {
      await page.goto(route, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800); // اكتمال أنيميشن الدخول
      const slug = route === '/' ? 'dashboard' : route.replace(/\//g, '');
      await expect(page).toHaveScreenshot(`${slug}-${testInfo.project.name}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.02,
        animations: 'disabled',
      });
    });
  }
});
