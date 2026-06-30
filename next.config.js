/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // وقائي: لا توقف بناء Vercel على أخطاء ESLint
  eslint: { ignoreDuringBuilds: true },
};

module.exports = nextConfig;
