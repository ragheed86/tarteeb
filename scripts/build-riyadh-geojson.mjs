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
  const out = { type: 'FeatureCollection', features };
  writeFileSync(OUT_PATH, JSON.stringify(out));
  console.log(`كُتب الملف إلى ${OUT_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
