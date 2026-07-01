// تطبيع أسماء الأحياء إلى مفتاح موحّد (match_key) يُستخدم لمطابقة بيانات العملاء
// مع مضلّعات GeoJSON. يُستخدم من طرفين: سكربت بناء الخريطة (scripts/build-riyadh-geojson.mjs)
// ومن وقت التشغيل (aggregate.js) — يجب أن يبقيا متطابقين حرفياً.
const AR_DIACRITICS = /[ً-ٰٟ]/g;

export function normalizeDistrictName(input) {
  let s = (input ?? '').trim();
  if (s.startsWith('حي ')) s = s.slice(3);
  s = s.replace(AR_DIACRITICS, '');
  s = s
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ء/g, '');
  s = s.replace(/\s+/g, '');
  if (s.startsWith('ال')) s = s.slice(2);
  return s;
}

// أسماء اختلف إملاؤها بين بيانات العملاء والمصدر الرسمي للخريطة
const DISTRICT_ALIASES = {};

export function districtMatchKey(name) {
  const n = normalizeDistrictName(name);
  return DISTRICT_ALIASES[n] ?? n;
}
