'use client';
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { colorFor } from '@/lib/heatmap/colors';

let rtlPluginLoaded = false;
function ensureRtlPlugin() {
  if (rtlPluginLoaded || typeof window === 'undefined') return;
  rtlPluginLoaded = true;
  maplibregl.setRTLTextPlugin(
    'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.js',
    true,
  );
}

// نمط مكتفٍ ذاتياً (لون خلفية + بلاطات CARTO) بدل ملف style.json خارجي،
// حتى تُرسم مضلّعات الأحياء دوماً حتى لو فشل تحميل البلاطات.
const STYLE = {
  version: 8,
  sources: {
    basemap: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap © CARTO',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#eef2f7' } },
    { id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-opacity': 0.9 } },
  ],
};

const RIYADH_CENTER = [46.6753, 24.7136];

export default function RiyadhNeighborhoodMap({ geojson, statsById, metric, scale, onSelect }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const hoveredIdRef = useRef(null);

  // مراجع تُحدَّث كل رندر حتى تقرأها معالجات الأحداث المسجَّلة مرة واحدة أحدث قيمة دائماً
  const statsByIdRef = useRef(statsById);
  statsByIdRef.current = statsById;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  function applyColors() {
    const map = mapRef.current;
    if (!map || !map.getSource('neighborhoods') || !map.isSourceLoaded('neighborhoods')) return;
    for (const f of geojson.features) {
      const id = f.properties.district_id;
      const s = statsById.get(id);
      const value = s ? metric.get(s) : 0;
      map.setFeatureState({ source: 'neighborhoods', id }, { color: colorFor(value, scale) });
    }
  }
  const applyColorsRef = useRef(applyColors);
  applyColorsRef.current = applyColors;

  // إنشاء الخريطة مرة واحدة فقط
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    ensureRtlPlugin();

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE,
      center: RIYADH_CENTER,
      zoom: 10.2,
      attributionControl: true,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    map.on('error', (e) => console.warn('maplibre:', e?.error?.message || e));

    const tooltip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });

    map.on('load', () => {
      map.addSource('neighborhoods', {
        type: 'geojson',
        data: geojson,
        promoteId: 'district_id',
      });

      map.addLayer({
        id: 'nh-fill',
        type: 'fill',
        source: 'neighborhoods',
        paint: {
          'fill-color': ['coalesce', ['feature-state', 'color'], '#E5E7EB'],
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.9, 0.65],
        },
      });
      map.addLayer({
        id: 'nh-line',
        type: 'line',
        source: 'neighborhoods',
        paint: {
          'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#272140', '#ffffff'],
          'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2, 0.6],
        },
      });
      map.on('mousemove', 'nh-fill', (e) => {
        if (!e.features?.length) return;
        const id = e.features[0].id;
        if (hoveredIdRef.current !== null && hoveredIdRef.current !== id) {
          map.setFeatureState({ source: 'neighborhoods', id: hoveredIdRef.current }, { hover: false });
        }
        hoveredIdRef.current = id;
        map.setFeatureState({ source: 'neighborhoods', id }, { hover: true });
        map.getCanvas().style.cursor = 'pointer';

        const props = e.features[0].properties;
        const s = statsByIdRef.current.get(String(props.district_id));
        const rows = s
          ? `<div>عملاء: ${s.clients}</div><div>مشاريع: ${s.projects}</div><div>قيمة العقود: ${Math.round(s.revenue).toLocaleString('en-US')}</div>`
          : '<div>لا نشاط مسجَّل</div>';
        tooltip.setLngLat(e.lngLat).setHTML(`<div style="font:13px 'IBM Plex Sans Arabic',sans-serif;direction:rtl;min-width:120px"><b>${props.name_ar}</b>${rows}</div>`).addTo(map);
      });
      map.on('mouseleave', 'nh-fill', () => {
        if (hoveredIdRef.current !== null) {
          map.setFeatureState({ source: 'neighborhoods', id: hoveredIdRef.current }, { hover: false });
          hoveredIdRef.current = null;
        }
        map.getCanvas().style.cursor = '';
        tooltip.remove();
      });
      map.on('click', 'nh-fill', (e) => {
        if (!e.features?.length) return;
        onSelectRef.current?.(String(e.features[0].properties.district_id));
      });

      // إضافة المصدر لا تعني جاهزيته فوراً؛ تحميل بيانات GeoJSON يتم بشكل غير متزامن (worker داخلي)،
      // فأي setFeatureState قبل اكتمال ذلك يُتجاهل بصمت. ننتظر حدث sourcedata الذي يؤكد الاكتمال.
      function onSourceData(e) {
        if (e.sourceId === 'neighborhoods' && map.isSourceLoaded('neighborhoods')) {
          map.off('sourcedata', onSourceData);
          applyColorsRef.current();
        }
      }
      map.on('sourcedata', onSourceData);
    });

    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      tooltip.remove();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geojson]);

  // إعادة تلوين فورية عبر feature-state عند تغيّر المقياس أو البيانات — بلا إعادة تحميل الخريطة
  useEffect(() => { applyColorsRef.current(); }, [statsById, metric, scale]);

  return <div ref={containerRef} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />;
}
