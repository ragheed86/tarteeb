/** @type {import('next').NextConfig} */
// React DevMode/HMR يحتاج eval() لإعادة بناء call stacks عند التصحيح؛ لن يُستخدم أبداً
// في بناء الإنتاج (Vercel)، لذا نسمح به محلياً فقط كي لا تظهر تحذيرات لا علاقة لها بالإنتاج.
const scriptSrc = process.env.NODE_ENV === 'development'
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com"
  : "script-src 'self' 'unsafe-inline' https://unpkg.com";

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self), payment=(), usb=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com https://fonts.openmaptiles.org",
      "img-src 'self' data: blob: https://*.supabase.co https://api.maptiler.com https://server.arcgisonline.com",
      "media-src 'self' blob: https://*.supabase.co",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.maptiler.com https://server.arcgisonline.com https://fonts.openmaptiles.org",
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
