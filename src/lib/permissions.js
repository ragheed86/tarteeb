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
      { key: 'appointments', label: 'المواعيد', description: 'الاجتماعات والمواعيد وربطها بتقويم الموظفين' },
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
      { key: 'loans', label: 'القروض والالتزامات', description: 'جدولة أقساط القروض وتسجيل السداد' },
      { key: 'payroll', label: 'الرواتب وتكلفة الموظفين', description: 'العقود والأجور والسلف ومسيّر الرواتب (رغيد ودلال فقط)' },
      { key: 'government', label: 'الجهات الحكومية', description: 'الحسابات والرخص والتنبيهات' },
    ],
  },
  {
    group: 'واتساب',
    items: [
      { key: 'whatsapp', label: 'محادثات واتساب', description: 'صندوق الوارد وسياق العملاء والاستلام البشري' },
      { key: 'whatsapp_pricing', label: 'اعتماد الأسعار', description: 'مراجعة واعتماد أسعار طلبات واتساب (رغد/دلال فقط)' },
      { key: 'whatsapp_booking', label: 'اعتماد الحجوزات', description: 'تأكيد أو رفض مواعيد الحجز' },
    ],
  },
];

export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((group) => group.items.map((item) => item.key));

// صلاحية الرواتب لا تُمنح بالدور: بيانات الأجور تُسنَد بالاسم لا بالمنصب،
// فلا يرثها أي مدير جديد تلقائياً.
export const RESTRICTED_PERMISSIONS = ['payroll'];

export const ROLE_PRESETS = {
  admin: ALL_PERMISSIONS.filter((permission) => !RESTRICTED_PERMISSIONS.includes(permission)),
  manager: ['dashboard', 'clients', 'projects', 'cost', 'warehouse', 'warehouse_inventory', 'warehouse_products', 'employees', 'appointments', 'heatmap', 'quotes', 'invoices', 'expenses', 'whatsapp'],
  accountant: ['dashboard', 'clients', 'projects', 'cost', 'quotes', 'invoices', 'expenses', 'bank_reconciliation', 'loans'],
  operations: ['dashboard', 'clients', 'projects', 'cost', 'warehouse', 'warehouse_inventory', 'warehouse_products', 'employees', 'appointments'],
  viewer: ['dashboard', 'clients', 'projects'],
};

export const ROLE_LABELS = {
  admin: 'مدير كامل',
  manager: 'مدير عمليات',
  accountant: 'محاسب',
  operations: 'تشغيل',
  viewer: 'مشاهدة فقط',
};

export const ROLE_LABELS_EN = {
  admin: 'Full Administrator',
  manager: 'Operations Manager',
  accountant: 'Accountant',
  operations: 'Operations',
  viewer: 'View Only',
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
  if (access?.isPrimaryAdmin) return true;
  const permissions = access?.permissions || [];
  // الرواتب لا يغطيها دور المدير: تُمنح بالاسم فقط.
  if (RESTRICTED_PERMISSIONS.includes(permission)) return permissions.includes(permission);
  if (access?.role === 'admin') return true;
  if (permission === 'warehouse') {
    return permissions.some((item) => ['warehouse', 'warehouse_inventory', 'warehouse_products'].includes(item));
  }
  return permissions.includes(permission);
}

export function permissionForPath(pathname) {
  const path = pathname || '/';
  if (path === '/') return 'dashboard';
  if (path.startsWith('/pricing')) return 'whatsapp_pricing';
  if (path.startsWith('/bookings')) return 'whatsapp_booking';
  if (path.startsWith('/inbox')) return 'whatsapp';
  if (path.startsWith('/clients')) return 'clients';
  if (path.startsWith('/projects')) return 'projects';
  if (path.startsWith('/cost')) return 'cost';
  if (path.startsWith('/warehouse')) return 'warehouse';
  if (path.startsWith('/employees')) return 'employees';
  if (path.startsWith('/appointments')) return 'appointments';
  if (path.startsWith('/calendar')) return 'appointments';
  if (path.startsWith('/heatmap')) return 'heatmap';
  if (path.startsWith('/quotes')) return 'quotes';
  if (path.startsWith('/invoices')) return 'invoices';
  if (path.startsWith('/company-expenses')) return 'expenses';
  if (path.startsWith('/bank-reconciliation')) return 'bank_reconciliation';
  if (path.startsWith('/loans')) return 'loans';
  if (path.startsWith('/payroll')) return 'payroll';
  if (path.startsWith('/partners')) return 'expenses';
  if (path.startsWith('/government')) return 'government';
  if (path.startsWith('/suppliers')) return 'warehouse';
  if (path.startsWith('/settings')) return 'settings';
  return 'dashboard';
}
