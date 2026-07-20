export const PRIMARY_ADMIN_EMAIL = 'r.kallajo@gmail.com';

export const PERMISSION_GROUPS = [
  {
    group: 'النظام',
    items: [
      { key: 'dashboard', label: 'لوحة المعلومات', description: 'الملخصات والمؤشرات العامة' },
      { key: 'settings', label: 'الإعدادات والصلاحيات', description: 'بيانات الشركة وإدارة المستخدمين' },
    ],
  },
  {
    group: 'العمليات',
    items: [
      { key: 'clients', label: 'العملاء', description: 'عرض وإدارة بيانات العملاء' },
      { key: 'projects', label: 'المشاريع', description: 'عرض وإدارة المشاريع' },
      { key: 'cost', label: 'تكلفة المشاريع', description: 'إدخال ومراجعة مصاريف المشاريع' },
      { key: 'warehouse', label: 'المستودع', description: 'عرض المخزون والأصناف' },
      { key: 'warehouse_inventory', label: 'جرد المستودع', description: 'تعديل الكميات وحدود التنبيه' },
      { key: 'warehouse_products', label: 'إضافة المنتجات', description: 'إضافة وتعديل وحذف الأصناف' },
      { key: 'employees', label: 'الموظفون', description: 'الفريق والمستندات' },
      { key: 'heatmap', label: 'الخريطة الحرارية', description: 'توزيع الطلبات حسب الأحياء' },
    ],
  },
  {
    group: 'المالية',
    items: [
      { key: 'quotes', label: 'عروض الأسعار', description: 'إنشاء وطباعة عروض الأسعار' },
      { key: 'invoices', label: 'الفواتير', description: 'إنشاء ومتابعة الفواتير' },
      { key: 'expenses', label: 'مصاريف الشركة', description: 'النفقات التشغيلية العامة' },
      { key: 'bank_reconciliation', label: 'المطابقة البنكية', description: 'استيراد ومطابقة حركات الحساب البنكي' },
      { key: 'government', label: 'الجهات الحكومية', description: 'الحسابات والرخص والتنبيهات' },
    ],
  },
];

export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((group) => group.items.map((item) => item.key));

export const ROLE_PRESETS = {
  admin: ALL_PERMISSIONS,
  manager: ['dashboard', 'clients', 'projects', 'cost', 'warehouse', 'warehouse_inventory', 'warehouse_products', 'employees', 'heatmap', 'quotes', 'invoices', 'expenses'],
  accountant: ['dashboard', 'clients', 'projects', 'cost', 'quotes', 'invoices', 'expenses', 'bank_reconciliation'],
  operations: ['dashboard', 'clients', 'projects', 'cost', 'warehouse', 'warehouse_inventory', 'warehouse_products', 'employees'],
  viewer: ['dashboard', 'clients', 'projects'],
};

export const ROLE_LABELS = {
  admin: 'مدير كامل',
  manager: 'مدير عمليات',
  accountant: 'محاسب',
  operations: 'تشغيل',
  viewer: 'مشاهدة فقط',
};

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isPrimaryAdmin(email) {
  return normalizeEmail(email) === PRIMARY_ADMIN_EMAIL;
}

export function normalizePermissions(permissions, email = '') {
  if (isPrimaryAdmin(email)) return ALL_PERMISSIONS;
  const allowed = new Set(ALL_PERMISSIONS);
  return [...new Set(permissions || [])].filter((permission) => allowed.has(permission));
}

export function canAccess(access, permission) {
  if (!permission) return true;
  if (!access?.active) return false;
  if (access?.isPrimaryAdmin || access?.role === 'admin') return true;
  const permissions = access?.permissions || [];
  if (permission === 'warehouse') {
    return permissions.some((item) => ['warehouse', 'warehouse_inventory', 'warehouse_products'].includes(item));
  }
  return permissions.includes(permission);
}

export function permissionForPath(pathname) {
  const path = pathname || '/';
  if (path === '/') return 'dashboard';
  if (path.startsWith('/clients')) return 'clients';
  if (path.startsWith('/projects')) return 'projects';
  if (path.startsWith('/cost')) return 'cost';
  if (path.startsWith('/warehouse')) return 'warehouse';
  if (path.startsWith('/employees')) return 'employees';
  if (path.startsWith('/heatmap')) return 'heatmap';
  if (path.startsWith('/quotes')) return 'quotes';
  if (path.startsWith('/invoices')) return 'invoices';
  if (path.startsWith('/company-expenses')) return 'expenses';
  if (path.startsWith('/bank-reconciliation')) return 'bank_reconciliation';
  if (path.startsWith('/partners')) return 'expenses';
  if (path.startsWith('/government')) return 'government';
  if (path.startsWith('/suppliers')) return 'warehouse';
  if (path.startsWith('/settings')) return 'settings';
  return 'dashboard';
}
