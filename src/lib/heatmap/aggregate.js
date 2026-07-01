// طبقة منطق أعمال بحتة — لا تعرف شيئاً عن MapLibre.
// تجمّع بيانات العملاء والمشاريع على مستوى الحي، اعتماداً على فهرس مبنيّ من GeoJSON.
import { districtMatchKey } from './normalize';

export function buildDistrictIndex(geojson) {
  const idx = new Map();
  for (const f of geojson.features) {
    const p = f.properties;
    if (!p.match_key || !p.district_id) continue;
    idx.set(p.match_key, { districtId: p.district_id, nameAr: p.name_ar });
  }
  return idx;
}

function emptyStats(nameAr) {
  return { nameAr, clients: 0, projects: 0, revenue: 0, avgContract: 0 };
}

// العميل هو الكيان الوحيد الذي يحمل الموقع (الحي)؛ المشاريع ترث موقعها من عميلها.
export function aggregateByDistrict({ clients, projects, index }) {
  const out = new Map();
  const clientById = new Map(clients.map((c) => [c.id, c]));

  function ensure(matchKey) {
    const entry = index.get(matchKey);
    if (!entry) return null;
    let s = out.get(entry.districtId);
    if (!s) { s = emptyStats(entry.nameAr); out.set(entry.districtId, s); }
    return s;
  }

  for (const c of clients) {
    const s = ensure(districtMatchKey(c.district));
    if (s) s.clients += 1;
  }

  for (const p of projects) {
    const client = clientById.get(p.client_id);
    if (!client) continue;
    const s = ensure(districtMatchKey(client.district));
    if (!s) continue;
    s.projects += 1;
    s.revenue += Number(p.sale_price || 0);
  }

  for (const s of out.values()) {
    s.avgContract = s.projects ? Math.round(s.revenue / s.projects) : 0;
  }
  return out;
}
