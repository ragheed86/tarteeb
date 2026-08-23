# Tarteeb SaaS App

نظام إدارة أعمال لشركة ترتيب (تنظيم المساحات) — الواجهة على Next.js والباك إند على Supabase.

## بنية المجلد

```
tarteeb/
├─ prototype/
│  └─ tarteeb-app.html          ← النموذج التفاعلي (مرجع التصميم)
├─ supabase/
│  └─ migrations/               ← سجل المخطط والسياسات وحاويات التخزين
├─ src/
│  ├─ lib/
│  │  ├─ supabase.js            ← تهيئة عميل Supabase
│  │  └─ data.js                ← دوال قراءة البيانات (عملاء، مشاريع، فواتير...)
│  └─ app/                      ← صفحات Next.js (App Router)
├─ .env.local.example
├─ .gitignore
└─ package.json
```

## الإعداد محلياً

```bash
npm install
cp .env.local.example .env.local   # ثم عبّئ القيم من Supabase
npm run dev                        # http://localhost:3000
```

لاختبارات الواجهة المصادَقة استخدم مشروع Supabase مخصصاً للاختبار واضبط
`SUPABASE_SERVICE_ROLE_KEY` و`PW_TEST_EMAIL`. لا تستخدم حساب الأدمن أو قاعدة الإنتاج.

## Supabase (قاعدة البيانات)

1. أنشئ مشروعاً جديداً أو اربط المشروع الحالي عبر Supabase CLI.
2. طبّق جميع الملفات الموجودة في `supabase/migrations` بترتيبها، ولا تشغّل `0001_init.sql` وحده.
3. Project Settings → API → انسخ الـ URL والمفتاح القابل للنشر إلى `.env.local`.
4. فعّل حماية كلمات المرور المسرّبة من إعدادات Auth في المشاريع الإنتاجية.

## GitHub (البيت الدائم للكود)

```bash
git init
git add .
git commit -m "Tarteeb SaaS App — initial scaffold"
git branch -M main
git remote add origin https://github.com/<user>/tarteeb.git
git push -u origin main
```

## Vercel (النشر)

1. vercel.com → Add New → Project → استورد ريبو `tarteeb` من GitHub.
2. أضف متغيّرات البيئة (نفس مفاتيح `.env.local`).
3. Deploy — وكل push على `main` ينشر تلقائياً.

## ملاحظات

- صافي الربح والهامش لا يُخزَّنان؛ يُحسبان عبر الـ view `project_financials`.
- بيانات الدخول الحكومية الحسّاسة تُخزَّن عبر Supabase Vault (لا نصاً صريحاً).
- جميع جداول `public` محمية بـRLS وصلاحيات التطبيق، والملفات الداخلية في حاويات خاصة تُعرض بروابط موقّعة مؤقتاً.
