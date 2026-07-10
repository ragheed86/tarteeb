// اختبارات دخانية لكل المسارات: لا سحب أفقي، لا أخطاء console، RTL سليم،
// وخلايا الجداول معنونة على الجوال. تتخطى تلقائياً إن غابت جلسة الاختبار.
const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROUTES = [
  '/', '/clients', '/projects', '/cost', '/warehouse', '/employees',
  '/heatmap', '/quotes', '/invoices', '/partners', '/suppliers', '/government', '/settings',
];

function hasAuthState() {
  try {
    const state = JSON.parse(readFileSync(path.join(__dirname, '..', 'playwright', '.auth', 'user.json'), 'utf8'));
    return (state.origins || []).length > 0;
  } catch { return false; }
}
const authed = hasAuthState();

test.describe('فحص دخاني للمسارات', () => {
  test.skip(!authed, 'لا جلسة اختبار — أضف SUPABASE_SERVICE_ROLE_KEY إلى .env.local');

  for (const route of ROUTES) {
    test(`صفحة ${route}`, async ({ page }, testInfo) => {
      const errors = [];
      page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
      await page.goto(route, { waitUntil: 'networkidle' });

      // RTL على مستوى الوثيقة
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

      // لا يزال على نفس المسار (لم يُعد للدخول)
      expect(page.url()).toContain(route === '/' ? '' : route);

      // لا سحب أفقي غير مقصود
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `سحب أفقي بمقدار ${overflow}px في ${route}`).toBeLessThanOrEqual(1);

      // على الجوال: أي جدول بيانات يجب أن تحمل خلاياه data-label
      if (testInfo.project.name === 'mobile') {
        const un = await page.evaluate(() => {
          const tables = [...document.querySelectorAll('table:not(.inv-items)')];
          let missing = 0;
          for (const t of tables) for (const td of t.querySelectorAll('tbody td')) {
            if (!td.hasAttribute('data-label')) missing += 1;
          }
          return missing;
        });
        expect(un, `خلايا بلا data-label في ${route}`).toBe(0);
      }

      // لا أخطاء console حقيقية (نتجاهل تحذيرات الموارد الخارجية للخريطة)
      const real = errors.filter((e) => !/maplibre|tile|Failed to load resource/i.test(e));
      expect(real, real.join('\n')).toHaveLength(0);
    });
  }
});
