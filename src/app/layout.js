import { headers } from 'next/headers';
import './globals.css';
import AppShell from './AppShell';
import { LanguageProvider } from '@/i18n/LanguageProvider';

export const metadata = {
  title: 'ترتيب · نظام إدارة الأعمال',
  description: 'نظام ERP لشركة ترتيب لتنظيم المساحات — الرياض',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ترتيب',
  },
  icons: {
    icon: [
      { url: '/favicon-48.png', sizes: '48x48', type: 'image/png' },
      { url: '/app-icon.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: '/favicon-48.png',
    apple: '/icons/apple-touch-icon.png',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#FAFAFA',
};

export default async function RootLayout({ children }) {
  // القراءة نفسها (بصرف النظر عن استخدام القيمة) هي ما يجعل Next.js يُضمّن
  // نفس الـnonce تلقائياً في سكربتاته الداخلية (hydration/RSC) — تدقيق M-4.
  const nonce = (await headers()).get('x-nonce');
  return (
    <html lang="ar" dir="rtl" data-csp-nonce={nonce}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Readex+Pro:wght@300;400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&family=Julius+Sans+One&display=swap"
          rel="stylesheet"
        />
        <link rel="preload" href="/fonts/saudi-riyal-regular.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/saudi-riyal-bold.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>
        <LanguageProvider>
          <AppShell>{children}</AppShell>
        </LanguageProvider>
      </body>
    </html>
  );
}
