'use client';
import { useEffect, useRef, useState } from 'react';

// عداد رقمي متحرك: يصعد الرقم بتخفيف ease-out خلال ~0.8 ثانية
// يحترم prefers-reduced-motion ويعرض القيمة النهائية الدقيقة عند الاكتمال
export default function AnimatedNumber({ value, format }) {
  const target = Number(value) || 0;
  const [display, setDisplay] = useState(target);
  const [done, setDone] = useState(true);
  const prev = useRef(null);

  useEffect(() => {
    const from = prev.current ?? 0;
    prev.current = target;
    if (from === target) { setDisplay(target); setDone(true); return undefined; }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(target); setDone(true); return undefined;
    }
    setDone(false);
    const dur = 800;
    const t0 = performance.now();
    let raf;
    const tick = (t) => {
      const p = Math.min((t - t0) / dur, 1);
      const eased = 1 - (1 - p) ** 3;
      setDisplay(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setDone(true);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  const shown = done ? target : Math.round(display);
  return <>{format ? format(shown) : shown}</>;
}
