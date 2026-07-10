export default function manifest() {
  return {
    name: 'ترتيب · نظام إدارة الأعمال',
    short_name: 'ترتيب',
    description: 'نظام إدارة الأعمال لشركة ترتيب',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#FAFAFA',
    theme_color: '#17A2A6',
    dir: 'rtl',
    lang: 'ar',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
