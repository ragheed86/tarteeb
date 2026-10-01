# معمارية تطبيق ترتيب — رحلة البيانات وحدود الوحدات

آخر تحديث: 01 أكتوبر 2026 (CRM-AUD-10، الدفعة الأولى).

## الصورة الكاملة

```
المتصفح (صفحات src/app/**)
   │  useAccess / canAccess  ← تُخفي الأزرار فقط، ليست حماية
   ▼
src/lib/data.js  +  src/lib/data/*.js   ← طبقة البيانات (عميل Supabase بجلسة المستخدم)
   │
   ▼
Supabase (Postgres)
   ├─ RLS: has_permission('<وحدة>') و can_write()   ← الحارس الحقيقي
   ├─ RPC ذرية للعمليات متعددة الخطوات (فواتير، عروض، دفعات، رواتب…)
   └─ Storage: حاويات خاصة بسياسات صلاحية الوحدة

src/app/api/**  (سيرفر، service role)  ← فقط لما يحتاج سراً أو صلاحية أعلى
src/proxy.js    ← جلسة الدخول، CSP مع nonce، حد محاولات /api/admin
```

**القاعدة:** أي فحص صلاحية في الواجهة هو تجربة استخدام فقط. ما يمنع المستخدم فعلاً هو RLS في قاعدة البيانات، وفحص `requirePermission` في مسارات `api`.

## طبقة البيانات

- `src/lib/data.js`: المجالات العامة (العملاء، المشاريع، التكاليف، المصاريف، المستودع، الموظفون، الموردون، الجهات، الفواتير، الإعدادات، تنظيف الملفات).
- `src/lib/data/*.js`: مجالات منفصلة، ويعيد `data.js` تصديرها كلها، فالصفحات تستورد دائماً من `@/lib/data`:

| الملف | المجال |
|---|---|
| `bank.js` | الحسابات البنكية والمطابقة |
| `loans.js` | القروض والأقساط والدفعات |
| `hr.js` | التكلفة والعقود والأجور والرواتب |
| `quotes.js` | عروض الأسعار عبر `save_quote_with_items` |
| `whatsapp.js` | صندوق واتساب، مراجعة الأسعار، الحجوزات |
| `appointments.js` | المواعيد ومزامنة تقويم Google |

- `src/lib/supabase.js`: العميل المشترك وكاش القراءة القصير `cachedSupabaseRead` / `clearSupabaseReadCache`.
- `src/lib/supabaseAdmin.js`: عميل service role. **سيرفر فقط**، ولا يُستورد في أي ملف `'use client'`.

## متى نستخدم مسار api بدل طبقة البيانات؟

فقط عندما تحتاج العملية سراً أو صلاحية لا يملكها المستخدم مباشرة:

- `api/admin/users`: إدارة حسابات الدخول (Supabase Admin API).
- `api/google-calendar/*`: OAuth وتوكنات Google المشفّرة في Vault.
- `api/appointments/sync`: المزامنة مع Google.

كل ما عدا ذلك يمر من طبقة البيانات والـRLS، ولا ننقل القراءة للسيرفر بلا سبب.

**استثناء معروف:** `settings/page.js` يكتب `app_user_access` مباشرة. هذا محمي بسياسة `is_primary_admin()`، لكن الأفضل نقله لـ`api/admin` في دفعة لاحقة.

## أنماط لازم نلتزم فيها

1. **عملية متعددة الخطوات = RPC واحد.** متل الرأس مع البنود، أو الدفعة مع تحديث الحالة. لا نسلسل عدة طلبات من المتصفح.
2. **التعديل المتزامن:** نمرّر `updated_at` المتوقع، والـRPC يرفض بـ`40001` إذا السجل تغيّر (متل `save_quote_with_items`).
3. **الملفات:** نحذف السجل أولاً، والـtrigger بيحط الملف بـ`storage_cleanup_queue`، وبعدها `processStorageCleanup()` بتحذفه. لا نحذف ملفاً قبل سجله، ولا نبتلع أخطاء التخزين.
4. **الدوال الداخلية** (triggers والمساعدات): `revoke execute ... from public, anon, authenticated`.
5. **أي تغيير بقاعدة البيانات = ملف هجرة في `supabase/migrations`.** شوف `docs/DB_DRIFT_2026-10-01.md` لسجل الهجرات المطبقة على الإنتاج وغير الموجودة هون.

## إضافة وحدة جديدة

1. هجرة: الجداول، وتفعيل RLS، وسياسات `has_permission('<وحدة>')` و`can_write()`، وأي RPC.
2. صلاحية جديدة في `src/lib/permissions.js`، وربط المسار بـ`permissionForPath`.
3. ملف `src/lib/data/<وحدة>.js` وسطر `export * from './data/<وحدة>'` في `data.js`.
4. الصفحة في `src/app/<وحدة>/page.js` ورابطها في `AppShell.jsx`.
5. إذا فيها ملفات: حاوية خاصة، وسياسات Storage، وإضافتها لـ`storage_bucket_permission` و`storage_path_in_use`، وtrigger التنظيف.
