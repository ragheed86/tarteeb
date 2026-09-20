'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'tarteeb-language';
const SUPPORTED_LANGUAGES = ['ar', 'en'];

const messages = {
  ar: {
    'language.arabic': 'العربية',
    'language.english': 'English',
    'language.switchToArabic': 'التبديل إلى العربية',
    'language.switchToEnglish': 'Switch to English',
    'nav.dashboard': 'لوحة المعلومات',
    'nav.dashboardSub': 'نظرة عامة على الأداء',
    'nav.whatsapp': 'واتساب',
    'nav.inbox': 'صندوق الوارد',
    'nav.inboxSub': 'محادثات واتساب مع العملاء',
    'nav.pricing': 'اعتماد الأسعار',
    'nav.pricingSub': 'مراجعة واعتماد أسعار طلبات واتساب',
    'nav.bookings': 'الحجوزات',
    'nav.bookingsSub': 'تأكيد مواعيد واتساب',
    'nav.operations': 'العمليات',
    'nav.clients': 'العملاء',
    'nav.clientsSub': 'قاعدة العملاء وملفاتهم',
    'nav.projects': 'المشاريع',
    'nav.projectsSub': 'مشاريع التنظيم الجارية',
    'nav.cost': 'تكلفة المشاريع',
    'nav.costSub': 'ابحث عن مشروع وأضف تكاليفه',
    'nav.warehouse': 'المستودع',
    'nav.warehouseSub': 'الأصناف والمخزون',
    'nav.employees': 'الموظفون',
    'nav.employeesSub': 'الفريق ومستنداتهم',
    'nav.marketing': 'التسويق',
    'nav.heatmap': 'الخريطة الحرارية',
    'nav.heatmapSub': 'كثافة الطلبات حسب أحياء الرياض',
    'nav.finance': 'المالية',
    'nav.quotes': 'عروض الأسعار',
    'nav.quotesSub': 'إنشاء وطباعة عروض الأسعار',
    'nav.invoices': 'الفواتير',
    'nav.invoicesSub': 'الفواتير والمدفوعات',
    'nav.expenses': 'مصاريف الشركة',
    'nav.expensesSub': 'النفقات التشغيلية بعيداً عن المشاريع',
    'nav.bank': 'المطابقة البنكية',
    'nav.bankSub': 'مطابقة كشف البنك مع السجلات المالية',
    'nav.reports': 'التقارير',
    'nav.reportsSub': 'تقارير مالية وتشغيلية وتحليلية',
    'nav.system': 'النظام',
    'nav.settings': 'الإعدادات',
    'nav.settingsSub': 'بيانات الشركة والموردون والرخص والصلاحيات',
    'nav.clientFile': 'ملف العميل',
    'nav.clientFileSub': 'بيانات العميل وسجله',
    'nav.projectDetails': 'تفاصيل المشروع',
    'nav.projectDetailsSub': 'المهام والفريق والتكاليف',
    'nav.invoice': 'الفاتورة',
    'nav.invoiceSub': 'تفاصيل الفاتورة والدفعات',
    'nav.suppliers': 'الموردون',
    'nav.suppliersSub': 'موردو المواد والمنظمات',
    'nav.government': 'الحسابات الحكومية',
    'nav.governmentSub': 'الرخص والاشتراكات',
    'app.menu': 'القائمة',
    'app.mainNavigation': 'التنقل الرئيسي',
    'app.globalSearch': 'بحث عام في العملاء',
    'app.searchPlaceholder': 'ابحث عن عميل أو جوال أو حي…',
    'app.user': 'مستخدم',
    'app.logout': 'خروج',
    'access.title': 'لا تملك صلاحية الوصول',
    'access.description': 'اطلب من الأدمن الأساسي تعديل صلاحيات حسابك من الإعدادات.',
    'install.title': 'ثبّت ترتيب كتطبيق على شاشتك الرئيسية',
    'install.instructions': 'اضغط مشاركة، ثم «إضافة إلى الشاشة الرئيسية»',
    'common.close': 'إغلاق',
    'auth.loginHelp': 'سجّل الدخول للوصول إلى نظام إدارة الأعمال',
    'auth.resetHelp': 'أدخل بريدك وسنرسل لك رابطاً لتعيين كلمة مرور جديدة',
    'auth.invalidCredentials': 'بيانات الدخول غير صحيحة، حاول مجدداً',
    'auth.resetFailed': 'تعذر إرسال رابط الاستعادة الآن. حاول مجدداً بعد قليل',
    'auth.supabaseMissing': 'إعدادات Supabase غير مكتملة في بيئة التشغيل',
    'auth.resetSent': 'إذا كان البريد مسجلاً، أرسلنا إليه رابط الاستعادة. افحص صندوق الوارد والرسائل غير المرغوب فيها.',
    'auth.email': 'البريد الإلكتروني',
    'auth.password': 'كلمة المرور',
    'auth.forgotPassword': 'نسيت كلمة المرور؟',
    'auth.sending': 'جارٍ الإرسال…',
    'auth.signingIn': 'جارٍ الدخول…',
    'auth.sendReset': 'إرسال رابط الاستعادة',
    'auth.signIn': 'دخول',
    'auth.backToLogin': 'العودة إلى تسجيل الدخول',
    'auth.passwordMin': 'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل',
    'auth.passwordMismatch': 'كلمتا المرور غير متطابقتين',
    'auth.updateFailed': 'تعذر تحديث كلمة المرور. أعد فتح رابط الاستعادة أو اطلب رابطاً جديداً',
    'auth.resetComplete': 'اكتملت استعادة الحساب بنجاح',
    'auth.choosePassword': 'اختر كلمة مرور جديدة لحسابك',
    'auth.invalidReset': 'رابط الاستعادة غير صالح أو انتهت صلاحيته. اطلب رابطاً جديداً من شاشة الدخول.',
    'auth.passwordUpdated': 'تم تحديث كلمة المرور. يمكنك الآن متابعة استخدام التطبيق.',
    'auth.continue': 'متابعة إلى التطبيق',
    'auth.newPassword': 'كلمة المرور الجديدة',
    'auth.confirmPassword': 'تأكيد كلمة المرور الجديدة',
    'auth.passwordTip': 'استخدم 8 أحرف على الأقل، ويفضل الجمع بين الحروف والأرقام والرموز.',
    'auth.updating': 'جارٍ التحديث…',
    'auth.updatePassword': 'تحديث كلمة المرور',
    'state.loading': 'جارٍ التحميل',
    'state.error': 'خطأ: {message}',
    'common.showMore': 'عرض المزيد',
    'common.of': 'من',
    'common.ok': 'حسنًا',
    'kpi.openDetails': 'عرض تفاصيل مؤشر {label}',
    'kpi.subtitle': 'شرح المؤشر وطريقة احتسابه',
    'kpi.defaultExplanation': 'يعرض هذا المؤشر القيمة المحسوبة من بيانات النظام الحالية.',
    'kpi.scope': 'النطاق',
    'kpi.formula': 'طريقة الحساب',
    'kpi.breakdown': 'تفاصيل الرقم',
    'error.title': 'حدث خطأ غير متوقّع',
    'error.description': 'تعذّر تحميل هذه الصفحة، حاول مرة أخرى.',
    'error.retry': 'إعادة المحاولة',
    'notFound.title': 'الصفحة غير موجودة',
    'notFound.description': 'الرابط الذي فتحته غير صحيح أو أُزيل.',
    'notFound.back': 'الرجوع للوحة المعلومات',
  },
  en: {
    'language.arabic': 'العربية',
    'language.english': 'English',
    'language.switchToArabic': 'Switch to Arabic',
    'language.switchToEnglish': 'Switch to English',
    'nav.dashboard': 'Dashboard',
    'nav.dashboardSub': 'Performance overview',
    'nav.whatsapp': 'WhatsApp',
    'nav.inbox': 'Inbox',
    'nav.inboxSub': 'WhatsApp conversations with customers',
    'nav.pricing': 'Pricing Approval',
    'nav.pricingSub': 'Review and approve WhatsApp pricing requests',
    'nav.bookings': 'Bookings',
    'nav.bookingsSub': 'Confirm WhatsApp appointments',
    'nav.operations': 'Operations',
    'nav.clients': 'Clients',
    'nav.clientsSub': 'Client database and profiles',
    'nav.projects': 'Projects',
    'nav.projectsSub': 'Active organization projects',
    'nav.cost': 'Project Costs',
    'nav.costSub': 'Find a project and add its costs',
    'nav.warehouse': 'Warehouse',
    'nav.warehouseSub': 'Products and inventory',
    'nav.employees': 'Employees',
    'nav.employeesSub': 'Team and documents',
    'nav.marketing': 'Marketing',
    'nav.heatmap': 'Heatmap',
    'nav.heatmapSub': 'Demand density across Riyadh districts',
    'nav.finance': 'Finance',
    'nav.quotes': 'Quotations',
    'nav.quotesSub': 'Create and print quotations',
    'nav.invoices': 'Invoices',
    'nav.invoicesSub': 'Invoices and payments',
    'nav.expenses': 'Company Expenses',
    'nav.expensesSub': 'Operating expenses outside projects',
    'nav.bank': 'Bank Reconciliation',
    'nav.bankSub': 'Match bank statements with financial records',
    'nav.reports': 'Reports',
    'nav.reportsSub': 'Financial, operational, and analytical reports',
    'nav.system': 'System',
    'nav.settings': 'Settings',
    'nav.settingsSub': 'Company details, suppliers, licenses, and permissions',
    'nav.clientFile': 'Client Profile',
    'nav.clientFileSub': 'Client details and history',
    'nav.projectDetails': 'Project Details',
    'nav.projectDetailsSub': 'Tasks, team, and costs',
    'nav.invoice': 'Invoice',
    'nav.invoiceSub': 'Invoice details and payments',
    'nav.suppliers': 'Suppliers',
    'nav.suppliersSub': 'Material and organizer suppliers',
    'nav.government': 'Government Accounts',
    'nav.governmentSub': 'Licenses and subscriptions',
    'app.menu': 'Menu',
    'app.mainNavigation': 'Main navigation',
    'app.globalSearch': 'Search clients',
    'app.searchPlaceholder': 'Search by client, phone, or district…',
    'app.user': 'User',
    'app.logout': 'Log out',
    'access.title': 'You do not have access',
    'access.description': 'Ask the primary administrator to update your permissions in Settings.',
    'install.title': 'Install Tarteeb on your Home Screen',
    'install.instructions': 'Tap Share, then “Add to Home Screen”',
    'common.close': 'Close',
    'auth.loginHelp': 'Sign in to access the business management system',
    'auth.resetHelp': 'Enter your email and we will send you a password reset link',
    'auth.invalidCredentials': 'Incorrect sign-in details. Please try again.',
    'auth.resetFailed': 'We could not send the reset link. Please try again shortly.',
    'auth.supabaseMissing': 'Supabase settings are incomplete in this environment.',
    'auth.resetSent': 'If this email is registered, we sent a recovery link. Check your inbox and spam folder.',
    'auth.email': 'Email address',
    'auth.password': 'Password',
    'auth.forgotPassword': 'Forgot password?',
    'auth.sending': 'Sending…',
    'auth.signingIn': 'Signing in…',
    'auth.sendReset': 'Send recovery link',
    'auth.signIn': 'Sign in',
    'auth.backToLogin': 'Back to sign in',
    'auth.passwordMin': 'Password must be at least 8 characters long.',
    'auth.passwordMismatch': 'Passwords do not match.',
    'auth.updateFailed': 'We could not update the password. Reopen the recovery link or request a new one.',
    'auth.resetComplete': 'Account recovery completed successfully',
    'auth.choosePassword': 'Choose a new password for your account',
    'auth.invalidReset': 'This recovery link is invalid or has expired. Request a new link from the sign-in page.',
    'auth.passwordUpdated': 'Your password has been updated. You can now continue using the app.',
    'auth.continue': 'Continue to the app',
    'auth.newPassword': 'New password',
    'auth.confirmPassword': 'Confirm new password',
    'auth.passwordTip': 'Use at least 8 characters and preferably combine letters, numbers, and symbols.',
    'auth.updating': 'Updating…',
    'auth.updatePassword': 'Update password',
    'state.loading': 'Loading',
    'state.error': 'Error: {message}',
    'common.showMore': 'Show more',
    'common.of': 'of',
    'common.ok': 'OK',
    'kpi.openDetails': 'View details for {label}',
    'kpi.subtitle': 'Metric definition and calculation',
    'kpi.defaultExplanation': 'This metric shows the value calculated from the current system data.',
    'kpi.scope': 'Scope',
    'kpi.formula': 'Calculation',
    'kpi.breakdown': 'Value breakdown',
    'error.title': 'Something went wrong',
    'error.description': 'We could not load this page. Please try again.',
    'error.retry': 'Try again',
    'notFound.title': 'Page not found',
    'notFound.description': 'The link you opened is incorrect or has been removed.',
    'notFound.back': 'Back to Dashboard',
  },
};

const LanguageContext = createContext(null);

function interpolate(message, values = {}) {
  return String(message).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? `{${key}}`);
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState('ar');

  const applyLanguage = useCallback((nextLanguage) => {
    const safeLanguage = SUPPORTED_LANGUAGES.includes(nextLanguage) ? nextLanguage : 'ar';
    document.documentElement.lang = safeLanguage;
    document.documentElement.dir = safeLanguage === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.dataset.language = safeLanguage;
    document.title = safeLanguage === 'ar' ? 'ترتيب · نظام إدارة الأعمال' : 'Tarteeb · Business Management System';
  }, []);

  useEffect(() => {
    const savedLanguage = localStorage.getItem(STORAGE_KEY);
    const initialLanguage = SUPPORTED_LANGUAGES.includes(savedLanguage) ? savedLanguage : 'ar';
    setLanguageState(initialLanguage);
    applyLanguage(initialLanguage);
  }, [applyLanguage]);

  const setLanguage = useCallback((nextLanguage) => {
    const safeLanguage = SUPPORTED_LANGUAGES.includes(nextLanguage) ? nextLanguage : 'ar';
    localStorage.setItem(STORAGE_KEY, safeLanguage);
    setLanguageState(safeLanguage);
    applyLanguage(safeLanguage);
  }, [applyLanguage]);

  const t = useCallback((key, values) => {
    const message = messages[language]?.[key] ?? messages.ar[key] ?? key;
    return interpolate(message, values);
  }, [language]);

  const value = useMemo(() => ({
    language,
    locale: language === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-SA-u-ca-gregory-nu-latn',
    direction: language === 'ar' ? 'rtl' : 'ltr',
    setLanguage,
    toggleLanguage: () => setLanguage(language === 'ar' ? 'en' : 'ar'),
    t,
  }), [language, setLanguage, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider');
  return context;
}

export function LanguageToggle({ compact = false }) {
  const { language, toggleLanguage, t } = useLanguage();
  const nextLanguage = language === 'ar' ? 'en' : 'ar';
  return (
    <button
      type="button"
      className={`language-toggle${compact ? ' compact' : ''}`}
      onClick={toggleLanguage}
      aria-label={t(nextLanguage === 'ar' ? 'language.switchToArabic' : 'language.switchToEnglish')}
      title={t(nextLanguage === 'ar' ? 'language.switchToArabic' : 'language.switchToEnglish')}
    >
      <span aria-hidden="true">文</span>
      <b>{nextLanguage === 'ar' ? t('language.arabic') : t('language.english')}</b>
    </button>
  );
}
