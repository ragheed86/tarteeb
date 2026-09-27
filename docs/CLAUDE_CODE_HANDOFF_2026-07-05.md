# Tarteeb Handoff — 2026-07-05

ملخّص لمتابعة العمل على واجهة أخرى. كل ما نُفّذ في جلسة 2026-07-05 منشور على الإنتاج.

## إحداثيات المشروع
- المسار المحلي: `/Users/Ragheed/Developer/tarteeb`
- الموقع الحيّ: `https://tarteeb-six.vercel.app`
- مشروع Vercel: `tarteeb/tarteeb-six` (id: `prj_Y9y1fU7PmWbkGuw0ZFBbO1FKWkCs`)
- Supabase ref: `yvxequegdyrhjghprnya`
- بيانات الدخول للتطبيق زوّدها المستخدم في الدردشة سابقاً — لا تطبعها ولا تلتزمها في git.

## أول خطوة
```bash
cd /Users/Ragheed/Developer/tarteeb
git status --short
npm run build
```
الشجرة فيها تعديلات محلية غير ملتزمة **مقصودة** (كل عمل الجلسات الأخيرة). لا تعمل reset لها.
آخر commit: `90f4380`. كل التعديلات اللاحقة نُشرت عبر `npx vercel --prod --yes` مباشرة دون commit.

## البناء والنشر والتحقّق
```bash
npm run build                 # يجب أن ينجح
npx vercel --prod --yes       # ينشر ثم يعمل alias إلى tarteeb-six.vercel.app
```
```bash
# تحقّق بعد النشر
for u in / /projects /cost /clients; do curl -s -o /dev/null -w "$u %{http_code}\n" "https://tarteeb-six.vercel.app$u"; done
```
**التحقّق البصري:** الموقع خلف مصادقة Supabase ولا تتوفّر بيانات دخول اختبار. النمط المستخدم: صفحة harness ثابتة مؤقتة في `public/_qa/` (نسخة من `globals.css` + ترميز مطابق للمكوّن) تُعاين على خادم dev ثم **تُحذف قبل النشر**. لا يوجد `tsc` مثبّت؛ التحقّق عبر `npm run build` + node لاختبار الدوال الصرفة.
- خادم dev للمعاينة: `.claude/launch.json` باسم `tarteeb-dev` على المنفذ 3002 (المسار مُصحّح إلى `/Users/Ragheed/Developer/tarteeb`).

## ما نُفّذ في جلسة 2026-07-05 (كله منشور)

### 1) إعادة تصميم تقرير المصاريف + مشاركة PDF واتساب
- `src/app/projects/[id]/report/page.js`: تصميم موبايل-أولاً بعمود واحد (أصناف `rpt-*`، حُذفت `expense-*` القديمة من globals.css).
- زر «مشاركة واتساب» يولّد PDF في المتصفح عبر `html2canvas` + `jspdf` (dynamic import عند الضغط، `windowWidth:1000`، تقطيع A4) ثم `navigator.share({files})`. fallback سطح المكتب: تنزيل الملف. الـblob مخزّن في ref لإعادة المشاركة (قيد user-gesture في iOS).
- الطباعة ما زالت A4 عمودي صفحة واحدة.

### 2) إصلاح درج القائمة على الجوال
- `globals.css`: قاعدة `.sidebar` داخل `@media(max-width:860px)` كانت `inset-inline-end` (=يسار في RTL) مع `translateX(100%)` فتبقى شريحة من القائمة فوق المحتوى. صُحّحت إلى `inset-inline-start`.
- **درس RTL:** off-canvas بـ translateX نسبي: `inline-start`=يمين، `inline-end`=يسار.

### 3) صفحة العملاء + الشعار + حقل الموظف
- `src/app/clients/page.js`: عمود الجوال موسّط (كان start). خلية الحالة صارت قائمة منسدلة `.status-select pill` تحفظ فوراً عبر `updateClient` (تفاؤلي مع تراجع).
- `.status-select` صنف جديد في globals.css (select يشبه pill مع سهم SVG على اليسار).
- **شعار الدخول:** لم يتوفّر ملف PNG المرفق (غير محفوظ على القرص/الحافظة)، فأُعيد إنشاؤه كـ**SVG متجه inline** في مكوّن `TarteebLogo` بـ AppShell.jsx بخط `Julius Sans One` (أُضيف لرابط الخطوط في layout.js). لون سلموني `#F0A896` + قوس، وتحته `ARRANGE & ORGANIZE` تركوازي `#83C0B4`. **لاستبدال الأصلي:** ضع PNG في public وبدّل المكوّن.
- `src/app/cost/page.js`: عمود اختياري «الموظف» بعد «عدد العمال» في جدول العمالة = select يجلب أسماء الموظفين (getEmployees) + خيار «فريلانسر (مستقل)». يُخزَّن في `worker` ويُسلسل في تسمية بند العمالة كـ`· الموظف: الاسم` داخل `estimateToCostRows` ويُستعاد في `costRowsToEstimate` (data.js). شبكة labor صارت 7 أعمدة عبر prop `headClass` في DailyTable.

### 4) توحيد حالة المشروع بين /projects و/cost
- لا ازدواج في قاعدة البيانات: عمود واحد `projects.status`. المشكلة كانت واجهية.
- `src/app/cost/page.js`: أُضيفت «حالة المشروع» (منسدلة) في بطاقة ملخص المشروع → `changeStatus` يكتب `projects.status`.
- `src/app/projects/page.js`: عمود الحالة في الجدول + pill البطاقة صارا select يستدعي `moveToStatus` الموجود (مع `stopPropagation`).
- المزامنة تلقائية لأن الصفحتين تجلبان `getProjects()` طازجاً عند التحميل وتكتبان نفس العمود (لا مخزن persist للمشاريع في هذا التطبيق).

### 5) إصلاح 3 أخطاء في لوحة المعلومات (`src/app/page.js`)
منطق مشترك أُضيف في `src/lib/format.js`:
- `DONE_STATUSES = ['delivered','completed']`
- `OPEN_DELIVERY_STATUSES = ['quote','preparing','in_progress']`
- `displayProgress(project)` → 100 للمكتمل/المُسلّم، وإلا `progress` اليدوي (يُصلح البيانات القديمة عند العرض بلا ترحيل).
- `progressForStatus(status, cur)` → 100 عند الاكتمال/التسليم (للحفظ).

الأخطاء المُصلحة:
- **التقدّم لا يتبع الحالة:** `progress` كان مستقلاً عن `status`. الآن العرض يشتق عبر `displayProgress` في (page.js, projects/page.js جدول/بطاقة/كانبان, projects/[id]), والحفظ يُثبّت 100 عبر `progressForStatus` في `moveToStatus` و cost `changeStatus` ونموذج تعديل المشروع (حقل النسبة يُعطّل ويظهر 100 عند حالة مكتملة).
- **التسليمات القادمة لا تسقط بعد التسليم:** `OPEN_DELIVERY` كان يضم `delivered`. صار `OPEN_DELIVERY_STATUSES` (بلا delivered/completed).
- **صافي الربح مبالغ فيه (103,503 لِـ«شهر»):** `withinDays` كانت تفحص الحد الأعلى فقط، فأي مشروع مستقبلي التاريخ يُحتسب. أُضيف حد أدنى: `diff >= 0 && diff <= days` (نافذة ماضية مغلقة). يُصلح تسريب الأرباح والإيرادات.

## مخطط/ملاحظات بيانات مهمة
- `projects`: أعمدة رئيسية `id,client_id,title,service_type,sale_price,status,supervisor_id,start_date,due_date,progress,created_at`. حالة واحدة فقط = `status`.
- تكاليف `/cost` تُسلسل في `project_costs.label` ببادئة `يومي: {date} · …`؛ بند العمالة: `يومي: {date} · عمالة: {n} عامل · الموظف: {name}` (الموظف اختياري). أعمدة إضافية مُستخدمة: `qty,hours,rate`.
- التقرير `/projects/[id]/report` يقرأ `project.sale_price` من Supabase. مشروع خولة (id `60fee63a-9524-47fd-9f5d-5fe2cd30f35e`) سعره في DB = 5000 بينما التقرير الثابت القديم كان يعرض 10000 — قرار معلّق: تحديث DB أو حقل قيمة-للتقرير.

## أخطاء/قيود معروفة وخطوات مقترحة
1. **دقّة صافي الربح** تعتمد على إدخال التكاليف: مشروع بلا تكاليف مسجّلة يُحتسب سعر بيعه بالكامل ربحاً. خيار مقترح: جعل المؤشر يعتمد على المحصّل الفعلي من الفواتير بدل `sale_price − cost`.
2. **تخزين الملفات**: مرفقات الفواتير/الوسائط ما زالت URL/preview؛ Supabase Storage غير مكتمل.
3. **صفحة تفاصيل المشروع** `/projects/[id]` تعرض الحالة pill للقراءة فقط (تعكس نفس العمود) — يمكن جعلها قابلة للتعديل لو رغب المستخدم.
4. **git**: تعديلات الجلسات غير ملتزمة (مقصود). عند الرغبة: commit بنمط conventional ثم push إلى main.
5. ملفات `.tmp-*.png` في الجذر ومجلدات `.specify/` و`specs/` غير متعلقة بعمل الجلسة.

## أنماط عمل معتمدة (من ذاكرة المشروع)
- كل الأرقام لاتينية (`en-US`)، التواريخ `ar-SA-u-nu-latn`. رمز الريال الجديد `⃁` (U+20C1) محمّل كخط مخصّص.
- نظام تصميم بنفسجي زجاجي؛ متغيّرات في `:root` بأعلى globals.css.
- سير النشر: تحقّق → build → `vercel --prod` → تأكيد 200، دون طلب تأكيد ما لم يوجد تغيير كاسر.
