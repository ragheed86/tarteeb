// يُشغَّل مرة واحدة يدوياً: node scripts/build-riyadh-geojson.mjs
// يجلب حدود كل أحياء السعودية، يصفّي أحياء الرياض فقط، يبسّط الإحداثيات،
// وينظّف الخصائص، ثم يكتب الناتج إلى public/riyadh-districts.geojson.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { districtMatchKey } from '../src/lib/heatmap/normalize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_URL = 'https://raw.githubusercontent.com/homaily/Saudi-Arabia-Regions-Cities-and-Districts/master/geojson/districts.geojson';
const RIYADH_CITY_ID = 3;
const OUT_PATH = join(__dirname, '..', 'public', 'riyadh-districts.geojson');

// وجهات الرياض الحديثة غير الموجودة بعد في مصدر الأحياء الأساسي.
// حدود خزام: OpenStreetMap way/1285193878، مرخّصة ODbL 1.0.
const SUPPLEMENTAL_FEATURES = [
  {
    type: 'Feature',
    properties: {
      district_id: 'osm-way-1285193878',
      name_ar: 'حي خزام',
      name_en: 'Khuzam Suburb',
      match_key: 'خزام',
      source: 'OpenStreetMap way/1285193878',
    },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [46.65376, 24.89644], [46.68187, 24.90988], [46.63423, 24.98675],
        [46.61645, 24.98358], [46.60505, 24.97559], [46.63743, 24.92298],
        [46.64538, 24.91006], [46.65376, 24.89644],
      ]],
    },
  },
];

function round(n) { return Math.round(n * 1e5) / 1e5; }
function roundCoords(coords) {
  if (typeof coords[0] === 'number') return coords.map(round);
  return coords.map(roundCoords);
}

async function main() {
  console.log('تنزيل districts.geojson (~22MB)...');
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`فشل التنزيل: ${res.status}`);
  const all = await res.json();
  console.log(`إجمالي المضلّعات بالسعودية: ${all.features.length}`);

  const features = all.features
    .filter((f) => f.properties?.city_id === RIYADH_CITY_ID)
    .map((f) => ({
      type: 'Feature',
      properties: {
        district_id: String(f.properties.district_id),
        name_ar: f.properties.name_ar ?? '',
        name_en: f.properties.name_en ?? '',
        match_key: districtMatchKey(f.properties.name_ar),
      },
      geometry: {
        type: f.geometry.type,
        coordinates: roundCoords(f.geometry.coordinates),
      },
    }));

  console.log(`أحياء الرياض بعد التصفية: ${features.length}`);
  const out = { type: 'FeatureCollection', features: [...features, ...SUPPLEMENTAL_FEATURES] };
  writeFileSync(OUT_PATH, JSON.stringify(out));
  console.log(`كُتب الملف إلى ${OUT_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
