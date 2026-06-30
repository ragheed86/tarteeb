# Tarteeb SaaS App

نظام إدارة أعمال لشركة ترتيب (تنظيم المساحات) — الواجهة على Next.js والباك إند على Supabase.

## بنية المجلد

```
tarteeb/
├─ prototype/
│  └─ tarteeb-app.html          ← النموذج التفاعلي (مرجع التصميم)
├─ supabase/
│  └─ migrations/
│     └─ 0001_init.sql          ← المخطط النظيف (يُشغّل في Supabase SQL Editor)
├─ src/
│  ├─ lib/
│  │  ├─ supabase.js            ← تهيئة عميل Supabase
│  │  └─ data.js                ← دوال قراءة البيانات (عملاء، مشاريع، فواتير...)
│  └─ app/                      ← صفحات Next.js (تُبنى لاحقاً)
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

## Supabase (قاعدة البيانات)

1. أنشئ مشروعاً جديداً (بداية نظيفة).
2. SQL Editor → الصق محتوى `supabase/migrations/0001_init.sql` → Run.
3. Project Settings → API → انسخ الـ URL ومفتاح anon إلى `.env.local`.

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
- سياسة RLS المبدئية: وصول كامل للمستخدم الموثّق؛ تُشدَّد بالأدوار لاحقاً.
