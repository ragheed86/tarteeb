# Tarteeb Six Handoff - Claude Code

## المطلوب الأصلي

- المرجع الوحيد للتصميم والمميزات: `/Users/Ragheed/Downloads/tartib-app_7.html`
- الهدف: نقل الأقسام والمميزات والتصاميم الناقصة إلى تطبيق Vercel:
  `https://tarteeb-six.vercel.app/`
- ممنوع إضافة أقسام أو قيم من ملفات قديمة أخرى.

## المشروع الصحيح

- مسار المشروع المحلي:
  `/Users/Ragheed/Downloads/tarteeb 3`
- Git remote:
  `https://github.com/ragheed86/tarteeb.git`
- Branch:
  `main`
- آخر commit تم دفعه:
  `982519a feat: match prototype sections`

## حالة Vercel

- المستخدم حذف مشروع Vercel القديم بالغلط.
- تم إنشاء مشروع Vercel جديد بنفس الاسم:
  `tarteeb-six`
- الحساب/الفريق:
  `tarteeb`
- Project ID الجديد:
  `prj_Y9y1fU7PmWbkGuw0ZFBbO1FKWkCs`
- رابط الإنتاج:
  `https://tarteeb-six.vercel.app/`
- آخر Deployment ناجح:
  `dpl_6d814NQF8BHRKyjXaovULzgRsKRo`
- حالة النشر:
  `READY`

## إعدادات Vercel التي تم ضبطها

- Framework:
  `nextjs`
- Build Command:
  `npm run build`
- Output Directory:
  الافتراضي الخاص بـ Next.js، وليس `.next`
- Node:
  `24.x`
- Environment Variables المرفوعة إلى Production:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- لم يتم رفع `SUPABASE_SERVICE_ROLE_KEY` للإنتاج لأنه غير مستخدم في صفحات العميل الحالية ولا يجب كشفه.

## أوامر النشر التي نجحت

```bash
npx vercel project add tarteeb-six --scope tarteeb
npx vercel link --yes --project tarteeb-six --scope tarteeb
npx vercel api '/v9/projects/prj_Y9y1fU7PmWbkGuw0ZFBbO1FKWkCs?teamId=team_tfM2gOi6NQigJnSBkg7zKVRB' -X PATCH -F framework=nextjs -F buildCommand="npm run build" --raw
npx vercel --prod --yes --scope tarteeb
```

## التغييرات المنفذة

### 1. القائمة الجانبية

الملف:
`src/app/AppShell.jsx`

تم تعديل القائمة لتطابق أقسام المثال:

- لوحة المعلومات
- العمليات
  - العملاء
  - المشاريع
  - تكلفة المشاريع
  - المستودع
  - الموظفون
- التسويق
  - الخريطة الحرارية
- المالية
  - الفواتير
  - حسابات الشركاء
- التواصل
  - الوارد الموحّد
- النظام
  - الإعدادات

تم حذف ظهور:

- الموردون كقسم مستقل في القائمة
- الجهات الحكومية كقسم مستقل في القائمة

لأن المثال يجعلها داخل الإعدادات.

### 2. صفحات جديدة

تمت إضافة:

- `src/app/cost/page.js`
  - صفحة تكلفة المشاريع
  - بحث واختيار مشروع
  - تفصيل التكاليف:
    - أجور عمالة
    - مواد ومنظمات
    - مواصلات ونقل
    - مكافأة المشرف
  - صافي الربح والهامش
  - waterfall مبسط

- `src/app/heatmap/page.js`
  - صفحة الخريطة الحرارية
  - أحياء الرياض حسب كثافة الطلبات
  - نفس القيم الموجودة في `tartib-app_7.html`

- `src/app/inbox/page.js`
  - صفحة الوارد الموحّد
  - محادثات واتساب/تيليجرام/بريد كما في المثال
  - محادثة نورة العتيبي

### 3. لوحة المعلومات

الملف:
`src/app/page.js`

تمت إضافة مكونات المثال:

- تسليمات قادمة مع عد تنازلي
- فلتر فترة:
  - يوم
  - أسبوع
  - شهر
  - سنة
- مؤشرات الأداء بقيم المثال
- مخطط الإيرادات والأرباح لآخر 6 أشهر
- مصدر العملاء:
  - انستقرام
  - تيك توك
  - توصية صديق
  - أخرى
- بقيت أجزاء الداتا الحية الحالية مثل:
  - تسليمات قريبة
  - تنبيهات المخزون
  - أحدث المشاريع

### 4. المشاريع

الملف:
`src/app/projects/page.js`

تمت إضافة مميزات المثال:

- تبديل عرض:
  - بطاقات
  - كانبان
  - تقويم
- فلتر تاريخ من/إلى
- جدول ملخص المشاريع
- كانبان بثلاث أعمدة:
  - قيد التجهيز
  - جاري التنفيذ
  - تم التسليم
- تقويم شهر يوليو 2026 يعرض المشاريع حسب تاريخ التسليم

تم الحفاظ على CRUD الحالي:

- إضافة مشروع
- تعديل مشروع
- حذف مشروع
- فتح تفاصيل المشروع

### 5. الإعدادات

الملف:
`src/app/settings/page.js`

تم تحويل الإعدادات إلى تبويبات كما في المثال:

- معلومات الشركة
- الموردون
- الجهات الحكومية والرخص
- الفريق والصلاحيات

ملاحظات:

- تبويب معلومات الشركة يستخدم نموذج الداتا الحقيقي الحالي.
- تبويب الموردون يربط إلى صفحة `/suppliers`.
- تبويب الجهات الحكومية يربط إلى صفحة `/government` ويعرض جدول الجهات من المثال.
- تبويب الفريق والصلاحيات يعرض أدوار المثال.

### 6. CSS

الملف:
`src/app/globals.css`

تمت إضافة ستايلات ناقصة من المثال:

- `countdowns`
- `cdcard`
- `viewtoggle`
- `toolbar`
- `costwrap`
- `cost-line`
- `result`
- `waterfall`
- `hmwrap`
- `hmgrid`
- `htile`
- `legend`
- `inbox`
- `convlist`
- `thread`
- `ptgrid`
- `kanban`
- `calendar`
- `settabs`
- `notebar`
- `perm`

## التحقق الذي تم

تم تشغيل:

```bash
npm run build
```

وكان ناجحاً.

تم النشر على Vercel بنجاح.

تم التحقق من الرابط:

```bash
curl -I https://tarteeb-six.vercel.app/
```

النتيجة:

- `HTTP/2 200`
- `x-vercel-cache: PRERENDER`

## ملاحظات مهمة

- التطبيق الإنتاجي لا يزال محمي بتسجيل دخول Supabase.
- لا يوجد تجاوز تسجيل دخول في الكود الحالي.
- كان هناك تشغيل محلي مؤقت على `3008` للمعاينة، لكن تم حذف كود التجاوز قبل النشر.
- إذا احتاج Claude Code يعاين بدون تسجيل دخول، يجب عمل حل preview مؤقت محلي فقط وعدم دفعه للإنتاج.

## ملفات تم تعديلها

```text
src/app/AppShell.jsx
src/app/globals.css
src/app/page.js
src/app/projects/page.js
src/app/settings/page.js
src/app/cost/page.js
src/app/heatmap/page.js
src/app/inbox/page.js
```

## أوامر مفيدة للمتابعة

```bash
cd "/Users/Ragheed/Downloads/tarteeb 3"
npm run build
npx vercel --prod --yes --scope tarteeb
npx vercel inspect https://tarteeb-six.vercel.app/ --scope tarteeb
git status --short
```

## آخر حالة Git وقت التسليم

- تم commit و push للتعديلات الأساسية:
  `982519a feat: match prototype sections`
- بعد إعادة إنشاء Vercel، تغير ملف `.vercel/project.json` محلياً ليربط المشروع الجديد.
- `.vercel/project.json` غير ظاهر في `git status` لأنه غير متتبع/متجاهل.

## ما يجب عمله بعد ذلك

1. افتح `https://tarteeb-six.vercel.app/`
2. سجل دخول بحساب Supabase الموجود.
3. راجع الصفحات:
   - `/`
   - `/projects`
   - `/cost`
   - `/heatmap`
   - `/inbox`
   - `/settings`
4. أي تعديل جديد يجب أن يقارن فقط مع:
   `/Users/Ragheed/Downloads/tartib-app_7.html`
