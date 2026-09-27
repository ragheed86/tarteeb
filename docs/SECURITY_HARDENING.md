# دليل تقوية الأمان — تطبيق ترتيب

هذا الدليل يوثّق إجراءات الأمان المنفّذة في الكود، والإجراءات التي تحتاج
إعدادات على لوحات تحكم خارجية (Supabase / Cloudflare / Vercel) يطبّقها المشغّل.

## ما هو منفّذ في الكود

- **RLS بنموذج read/write/delete**: القراءة بشرط صلاحية الوحدة، والكتابة/الحذف
  تشترط إضافةً `can_write()` (يمنع دور «المشاهدة فقط»). اختبارات في
  `tests/rls_permissions_test.sql` (`npm run test:rls`).
- **إجماليات الفواتير تُحتسب في القاعدة** (لا تُؤخذ من المتصفح).
- **دفعات الفواتير ذرّية** مع قفل الصف (`add_invoice_payment`) — لا تجاوز تحت التزامن.
- **رؤوس الأمان** في `next.config.js`: CSP، HSTS، COOP، CORP، X-Frame-Options،
  X-Content-Type-Options، Referrer-Policy، Permissions-Policy.
- **سكربت RTL مستضاف محليًا** (`public/vendor`) بدل unpkg.
- **تحديد معدّل** على مسار `api/admin/users` (في الذاكرة لكل نسخة خادم) — `_rateLimit.js`.

## إجراءات تحتاج إعدادًا خارجيًا (على المشغّل تنفيذها)

### 1) Supabase Auth
- **حدود المحاولات (Rate limits)**: Dashboard → Authentication → Rate Limits —
  ضبط حدود تسجيل الدخول/التسجيل/استعادة كلمة المرور.
- **CAPTCHA**: Authentication → Settings → Bot and Abuse Protection — تفعيل
  hCaptcha/Turnstile لصفحات الدخول والاستعادة.
- **MFA للأدمن**: تفعيل Multi-Factor Authentication ومطالبة حسابات الأدمن بها.
- **SSR cookies**: عند الانتقال لجلسات على الخادم استخدم `@supabase/ssr`
  بكوكيز `HttpOnly` و`Secure` و`SameSite=Lax`.

### 2) الحافة (Cloudflare أو Vercel WAF)
- تفعيل **WAF** وقواعد OWASP الأساسية.
- **Rate limiting / DDoS** على مستوى الحافة (أقوى من الحد داخل التطبيق).
- عدم كشف IP الخادم مباشرةً؛ توجيه كل الحركة عبر البروكسي/الحافة.

### 3) طبقة cache موزّعة (اختياري — مؤجّل)
- عند الحاجة لأداء أعلى للبيانات المرجعية: استبدال الـ cache المحلي بـ Redis/Upstash
  بمفتاح لكل مستأجر/مستخدم وإبطال بعد الكتابة.

## متابعات مفتوحة
- إزالة `'unsafe-inline'` من `script-src` عبر nonce في `middleware.js`
  (يتطلب اختبار تشغيل على staging: ترطيب Next وعامل RTL في الخريطة).
- تعطيل أزرار الكتابة/الحذف في الواجهة لدور «المشاهدة فقط» (الحماية مضمونة
  عبر RLS؛ هذا تحسين تجربة وطبقة دفاع إضافية).
