#!/usr/bin/env node
// يقارن مفاتيح الصلاحيات المعرَّفة في src/lib/permissions.js (طبقة الواجهة)
// مقابل المفاتيح التي تُطبَّق فعلياً في هجرات SQL (RLS + دوال has_permission).
// الهدف: كشف الانحراف بين المصدرين قبل أن يصل إلى الإنتاج — انظر تدقيق ترتيب،
// البند #3 (ازدواج مصدر حقيقة الصلاحيات).
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const permissionsSrc = readFileSync(join(root, 'src/lib/permissions.js'), 'utf8');
const migrationsDir = join(root, 'supabase/migrations');

// 1) مفاتيح الصلاحيات المعرَّفة في الواجهة (JS)
const jsKeys = new Set(
  [...permissionsSrc.matchAll(/key:\s*'([a-z_]+)'/g)].map((m) => m[1]),
);

// 2) مفاتيح الصلاحيات المُطبَّقة فعلياً في SQL — نمطان:
//    أ) استدعاء صريح: has_permission('key')
//    ب) مولّد سياسات RLS الخاص بأزواج (جدول، مفتاح صلاحية): يظهر فقط داخل
//       "foreach item slice 1 in array array[...]" — يُستثنى عمداً نمط
//       "foreach x in array array['a','b']" (قائمة أسماء جداول مسطّحة تشارك
//       مفتاحاً واحداً مكتوباً حرفياً داخل الحلقة، وليس عنصراً من المصفوفة).
const sqlKeys = new Set();
const migrationFiles = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
for (const file of migrationFiles) {
  const sql = readFileSync(join(migrationsDir, file), 'utf8');
  for (const m of sql.matchAll(/has_permission\('([a-z_]+)'\)/g)) sqlKeys.add(m[1]);
  for (const block of sql.matchAll(/slice\s+1\s+in\s+array\s+array\[([\s\S]*?)\]\s*loop/gi)) {
    for (const m of block[1].matchAll(/array\[\s*'[^']+'\s*,\s*'([a-z_]+)'\s*\]/g)) sqlKeys.add(m[1]);
  }
}

const onlyInJs = [...jsKeys].filter((k) => !sqlKeys.has(k)).sort();
const onlyInSql = [...sqlKeys].filter((k) => !jsKeys.has(k)).sort();

console.log(`مفاتيح JS: ${jsKeys.size} · مفاتيح SQL: ${sqlKeys.size}`);

if (onlyInJs.length === 0 && onlyInSql.length === 0) {
  console.log('✅ لا انحراف — كل مفتاح في permissions.js له تطبيق مقابل في SQL والعكس.');
  process.exit(0);
}

if (onlyInJs.length) {
  console.log('\n⚠️  مفاتيح معرَّفة في permissions.js لكن غير مُطبَّقة في أي RLS/RPC:');
  for (const k of onlyInJs) console.log(`   - ${k}`);
  console.log('   (قد تكون مقصودة — مثلاً مفتاح تنقّل واجهة بلا جدول خاص به. تحقّقوا يدوياً.)');
}

if (onlyInSql.length) {
  console.log('\n⚠️  مفاتيح مُطبَّقة في SQL لكن غائبة عن permissions.js:');
  for (const k of onlyInSql) console.log(`   - ${k}`);
  console.log('   (خطر حقيقي: صلاحية تعمل في قاعدة البيانات بلا أي واجهة تديرها.)');
}

// لا نفشل العملية (exit 1) تلقائياً بعد — القائمة الأولى تحتمل نتائج مقصودة سليمة.
// راجعوا القائمة الثانية (onlyInSql) بعناية؛ حوّلوها لفشل صريح لاحقاً إن رغبتم بإنفاذ أصرم في CI.
process.exit(0);
