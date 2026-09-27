/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self), payment=(), usb=()' },
  // HSTS: يفرض HTTPS لمدة سنتين لكل النطاقات الفرعية (سارٍ فقط عبر HTTPS في الإنتاج).
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // عزل سياق التصفح ومنع تحميل موارد الموقع من أصول أخرى.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      // أُزيل unpkg (سكربت RTL صار مستضافاً محلياً في public/vendor).
      // ملاحظة: إزالة 'unsafe-inline' من script-src تتطلب nonce عبر middleware
      // واختبار تشغيل على staging (ترطيب Next + عامل RTL في الخريطة) — متابعة منفصلة.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com https://fonts.openmaptiles.org",
      "img-src 'self' data: blob: https://*.supabase.co https://*.basemaps.cartocdn.com",
      "media-src 'self' blob: https://*.supabase.co",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://fonts.openmaptiles.org https://*.basemaps.cartocdn.com",
      "worker-src 'self' blob:",
      'upgrade-insecure-requests',
    ].join('; '),
  },
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

module.exports = nextConfig;
