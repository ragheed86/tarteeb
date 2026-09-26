/** @type {import('next').NextConfig} */
// تدقيق M-4: Content-Security-Policy انتقل إلى src/middleware.js لأن إغلاق
// 'unsafe-inline' في script-src يتطلّب nonce مختلفاً لكل طلب (لا يمكن ضبطه
// كرأس ثابت هنا).
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self), payment=(), usb=()' },
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

module.exports = nextConfig;
