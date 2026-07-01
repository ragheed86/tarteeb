export default function manifest() {
  return {
    name: 'ترتيب · نظام إدارة الأعمال',
    short_name: 'ترتيب',
    description: 'نظام إدارة الأعمال لشركة ترتيب',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#F5F3FD',
    theme_color: '#6C4DE0',
    dir: 'rtl',
    lang: 'ar',
    icons: [
      {
        src: '/app-icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any maskable',
      },
    ],
  };
}
