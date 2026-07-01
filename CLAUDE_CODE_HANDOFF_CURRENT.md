# Tarteeb Handoff - 2026-07-01

## المسار

المشروع المحلي:

`/Users/Ragheed/Downloads/tarteeb 3`

الرابط المحلي أثناء العمل:

`http://127.0.0.1:3008`

الرابط الإنتاجي المطلوب:

`https://tarteeb-six.vercel.app/`

Vercel scope/project:

`tarteeb/tarteeb-six`

Vercel project id:

`prj_Y9y1fU7PmWbkGuw0ZFBbO1FKWkCs`

> ملاحظة: إذا ظهر project id مختلف في `.vercel/project.json` اعتمد الموجود هناك، لأنه تم سحبه من Vercel CLI.

## آخر حالة Git

آخر commit مرفوع:

`74ea2e4 feat: update client project warehouse forms`

تم عمل:

`git push origin main`

الحالة قبل التسليم:

- الكود المطلوب متعمل ومرفوع.
- يوجد ملف handoff قديم غير متتبع: `CLAUDE_CODE_HANDOFF_2026-07-01.md`.
- هذا الملف جديد للتسليم الحالي: `CLAUDE_CODE_HANDOFF_CURRENT.md`.

## الملفات التي تم تعديلها

- `src/app/clients/page.js`
- `src/app/projects/page.js`
- `src/app/warehouse/page.js`
- `src/app/globals.css`
- `src/lib/format.js`

## المطلوب من المستخدم في آخر طلب وتم تنفيذه

### العملاء

تم تعديل صفحة العملاء:

- إضافة خيار مصدر: `عن طريق عميل`.
- عند اختيار `عن طريق عميل` تظهر قائمة بأسماء العملاء الموجودين.
- إضافة خيار مصدر: `عن طريق موظف`.
- عند اختيار `عن طريق موظف` تظهر قائمة بأسماء الموظفين الموجودين.
- إضافة تسميات المصدر الجديدة في `SOURCE_LABEL`.
- تحويل حقل الحي إلى قائمة أحياء من الرياض.

ملاحظة مهمة:

- قاعدة البيانات لا تحتوي عمود خاص باسم العميل/الموظف المحيل.
- لذلك يتم حفظ اسم المحيل داخل `notes` كسطر:
  `مصدر الإحالة: الاسم`

### المشاريع

تم تعديل نافذة مشروع جديد/تعديل مشروع:

- تغيير تسمية `المشرف` إلى `حجز المشرف`.
- تغيير تسمية `التقدّم (%)` إلى `حالة المشروع (%)`.
- إضافة قسم جديد باسم `جدول تقديري`.
- الجدول التقديري يحتوي:
  - عدد العاملين
  - ساعات العامل
  - سعر الساعة
  - إجمالي العاملين محسوب تلقائياً
  - عدد المشرفين
  - ساعات المشرف
  - سعر ساعة المشرف
  - إجمالي المشرفين محسوب تلقائياً
  - تكلفة المنتجات
  - النقل
  - أخرى
  - إجمالي الجدول التقديري

ملاحظة مهمة:

- الجدول التقديري حالياً UI فقط ولا يتم حفظه في قاعدة البيانات.
- السبب: جدول `projects` الحالي لا يحتوي أعمدة لهذه القيم.
- إذا المطلوب حفظ القيم لاحقاً، يلزم migration جديد أو جدول تقديرات مستقل.

### المستودع

تم تعديل صفحة المستودع:

- إضافة بطاقات أعلى الصفحة تعرض لكل مستودع:
  - اسم المستودع
  - عدد الأصناف
  - تكلفة المنتجات = `quantity * unit_cost`
- عرض 3 مستودعات من قاعدة البيانات.
- أول مستودع غير الرياض يتم عرضه باسم `مستودع الشمال` إذا لم يكن موجوداً بالاسم.
- `مستودع الرياض` يبقى كما هو.
- إضافة زر `رفع صورة المنتج` داخل نموذج الصنف.
- إضافة preview للصورة المرفوعة.
- إضافة زر `تصوير الباركود`.
- عند تصوير/رفع صورة باركود:
  - تظهر صورة الباركود.
  - يحاول المتصفح قراءة الرقم تلقائياً باستخدام `BarcodeDetector`.
  - إذا لم يدعم المتصفح القراءة، تظهر رسالة ويقدر المستخدم يكتب الرقم يدوياً.

ملاحظة مهمة:

- صورة المنتج وصورة الباركود حالياً UI preview فقط ولا يتم حفظها.
- السبب: جدول `inventory_items` الحالي لا يحتوي أعمدة للصور.
- إذا المطلوب حفظ الصور لاحقاً، يلزم إضافة Supabase Storage + أعمدة مثل `image_url` و`barcode_image_url`.

## التحقق المحلي

تم تشغيل:

`npm run build`

النتيجة:

- build ناجح.
- صفحات `/clients`, `/projects`, `/warehouse` رجعت `200 OK` محلياً بعد إعادة تشغيل dev server.

ملاحظة:

- حصل خطأ مؤقت في dev server بعد build:
  `Cannot find module './682.js'`
- تم حله بإعادة تشغيل السيرفر المحلي على port `3008`.

## حالة Vercel

تم محاولة النشر:

`npx vercel --prod --yes --scope tarteeb`

النشر بدأ على المشروع الصحيح:

`tarteeb/tarteeb-six`

لكن آخر deployment بقي عالق:

`https://tarteeb-66r255jcf-tarteeb.vercel.app`

الحالة:

`UNKNOWN`

النشر السابق الجاهز:

`https://tarteeb-owp2lutrl-tarteeb.vercel.app`

الحالة:

`Ready`

الرابط الأساسي `https://tarteeb-six.vercel.app/` كان يرجع `200 OK` لكنه غالباً ما زال على النشر السابق حتى يكتمل نشر جديد.

## مهم جداً عن متغيرات Supabase في Vercel

أثناء محاولة prebuilt ظهر أن:

- `.env.production` المحلي يحتوي قيم Supabase.
- `.vercel/.env.production.local` الذي سحبه Vercel كان فيه:
  - `NEXT_PUBLIC_SUPABASE_URL=""`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY=""`

بدأت عملية حذف وإعادة إضافة المتغيرات في Vercel، والمستخدم أوقفها.

بعد الإيقاف تم فحص Vercel:

`npx vercel env ls --scope tarteeb`

وظهر أن المتغيرين موجودين في Production وتم إنشاؤهما حديثاً:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

لكن يجب على Claude التأكد أن القيم ليست فارغة قبل النشر النهائي:

```bash
npx vercel env pull .vercel/.env.production.local --environment=production --scope tarteeb
sed -n '1,10p' .vercel/.env.production.local | sed 's/=.*/=<hidden>/'
```

إذا ظهرت القيم فاضية، أعد إضافتها من `.env.production` المحلي بدون طباعة الأسرار.

## أوامر مقترحة للمتابعة على Claude

من داخل:

`/Users/Ragheed/Downloads/tarteeb 3`

نفذ:

```bash
git status --short
npm run build
npx vercel env ls --scope tarteeb
npx vercel ls tarteeb-six --scope tarteeb
```

إذا المتغيرات صحيحة:

```bash
npx vercel --prod --yes --scope tarteeb
```

إذا النشر العادي علق مرة ثانية، استخدم prebuilt:

```bash
set -a
source .env.production
set +a
npx vercel build --prod --scope tarteeb
npx vercel deploy --prebuilt --prod --yes --scope tarteeb
```

بعد النشر تحقق من:

```bash
curl -I https://tarteeb-six.vercel.app/
curl -I https://tarteeb-six.vercel.app/clients
curl -I https://tarteeb-six.vercel.app/projects
curl -I https://tarteeb-six.vercel.app/warehouse
```

## نقاط تحتاج قرار لاحق

- هل جدول التقدير في المشاريع يجب حفظه في قاعدة البيانات؟
- هل صور المنتجات والباركود يجب حفظها في Supabase Storage؟
- إذا نعم، يلزم migration جديد وتعديل `src/lib/data.js`.
