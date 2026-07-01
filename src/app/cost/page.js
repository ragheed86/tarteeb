'use client';
import { useMemo, useState } from 'react';
import { fmtMoney } from '@/lib/format';

const projects = [
  { name: 'تنظيم دواليب', client: 'نورة العتيبي', price: 3200, labor: 900, materials: 550, transport: 150, bonus: 150 },
  { name: 'تنظيم غرفة ملابس', client: 'نورة العتيبي', price: 2800, labor: 800, materials: 600, transport: 120, bonus: 120 },
  { name: 'استشارة تنظيم منزلي', client: 'نورة العتيبي', price: 3400, labor: 1200, materials: 300, transport: 200, bonus: 200 },
  { name: 'تنظيم مطبخ كامل', client: 'عبدالله الشهري', price: 4800, labor: 1200, materials: 850, transport: 200, bonus: 300 },
  { name: 'تنظيم مكتب منزلي', client: 'عبدالله الشهري', price: 2600, labor: 700, materials: 500, transport: 150, bonus: 120 },
  { name: 'باكج نقل وتغليف', client: 'ريم القحطاني', price: 6500, labor: 2200, materials: 1100, transport: 600, bonus: 350 },
  { name: 'غرفة أطفال', client: 'سارة المطيري', price: 2400, labor: 700, materials: 450, transport: 120, bonus: 100 },
  { name: 'تنظيم مكتب', client: 'فهد الدوسري', price: 3900, labor: 1000, materials: 700, transport: 180, bonus: 220 },
  { name: 'تنظيم مستودع', client: 'فهد الدوسري', price: 4100, labor: 1300, materials: 600, transport: 250, bonus: 200 },
  { name: 'تخزين مخصص', client: 'منيرة السبيعي', price: 5200, labor: 1500, materials: 900, transport: 300, bonus: 300 },
  { name: 'تنظيم دواليب', client: 'منيرة السبيعي', price: 3000, labor: 850, materials: 520, transport: 140, bonus: 140 },
];

export default function CostPage() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(projects[3]);
  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return projects.filter((p) => `${p.name} ${p.client}`.includes(q));
  }, [query]);
  const total = selected.labor + selected.materials + selected.transport + selected.bonus;
  const profit = selected.price - total;
  const margin = Math.round((profit / selected.price) * 100);

  function pick(p) {
    setSelected(p);
    setQuery(`${p.name} · ${p.client}`);
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="searchwrap" style={{ flex: 1, minWidth: 240, position: 'relative' }}>
            <div className="fsearch" style={{ marginBottom: 0 }}>
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="اكتب اسم المشروع أو العميل لإضافة تكاليفه..." />
            </div>
            <div className={`ac${query.trim() ? ' open' : ''}`}>
              {filtered.length === 0 ? (
                <div className="presult" style={{ color: 'var(--muted)', cursor: 'default' }}>لا يوجد مشروع مطابق</div>
              ) : filtered.map((p) => (
                <div className="presult" key={`${p.name}-${p.client}`} onClick={() => pick(p)}>
                  <span>{p.name} · {p.client}</span><span className="pa">اختيار +</span>
                </div>
              ))}
            </div>
          </div>
          <select className="fselect" value={`${selected.name}|${selected.client}`} onChange={(e) => {
            const [name, client] = e.target.value.split('|');
            const p = projects.find((x) => x.name === name && x.client === client);
            if (p) pick(p);
          }}>
            <option value="">— أو اختر من القائمة —</option>
            {projects.map((p) => <option key={`${p.name}-${p.client}`} value={`${p.name}|${p.client}`}>{p.name} · {p.client}</option>)}
          </select>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div><div className="uid">مشروع · TRT-021-P2</div><h2 style={{ fontFamily: 'var(--display)', fontSize: 18, fontWeight: 600 }}>{selected.name} · {selected.client}</h2></div>
        <div style={{ marginInlineStart: 'auto', textAlign: 'start' }}><div className="uid">سعر البيع</div><div style={{ fontFamily: 'var(--display)', fontSize: 22, fontWeight: 600 }}>{fmtMoney(selected.price)} ر.س</div></div>
      </div>

      <div className="costwrap">
        <div className="card">
          <div className="sec-head"><h2>تفصيل التكاليف</h2><button className="btn ghost sm" style={{ marginInlineStart: 'auto' }}>بند</button></div>
          <CostLine icon="👤" label="أجور عمالة" value={selected.labor} />
          <CostLine icon="📦" label="مواد ومنظمات" value={selected.materials} />
          <CostLine icon="🚚" label="مواصلات ونقل" value={selected.transport} />
          <CostLine icon="⭐" label="مكافأة المشرف" value={selected.bonus} />
          <div className="cost-line" style={{ borderBottom: 0, fontWeight: 600 }}><div className="lft" style={{ marginInlineStart: 41 }}>إجمالي التكلفة</div><b style={{ color: 'var(--neg)' }}>{fmtMoney(total)} ر.س</b></div>
        </div>
        <div>
          <div className="result">
            <div className="mg">صافي ربح المشروع</div>
            <div className="big">{fmtMoney(profit)} ر.س</div>
            <div className="mg">هامش الربح {margin}% · يُحتسب تلقائياً من البنود</div>
          </div>
          <div className="card waterfall">
            <div className="wf"><span className="wl">سعر البيع</span><div className="wbar" style={{ width: '100%', background: 'var(--sage)' }}>{fmtMoney(selected.price)}</div></div>
            <div className="wf"><span className="wl">التكلفة</span><div className="wbar" style={{ width: `${Math.round((total / selected.price) * 100)}%`, background: 'var(--neg)' }}>{fmtMoney(total)}</div></div>
            <div className="wf"><span className="wl">صافي الربح</span><div className="wbar" style={{ width: `${Math.max(Math.round((profit / selected.price) * 100), 0)}%`, background: 'var(--green)' }}>{fmtMoney(profit)}</div></div>
          </div>
        </div>
      </div>
    </>
  );
}

function CostLine({ icon, label, value }) {
  return <div className="cost-line"><div className="lft"><div className="ic">{icon}</div>{label}</div><b>{fmtMoney(value)} ر.س</b></div>;
}
