import { useLayoutEffect, useRef, useState } from 'react';

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setSize((s) => (Math.abs(s.w - width) > 0.5 || Math.abs(s.h - height) > 0.5 ? { w: Math.floor(width), h: Math.floor(height) } : s));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** "Nice" axis maximum and tick step for 0-based axes. */
export function niceMax(v: number, ticks = 5): { max: number; step: number } {
  if (!(v > 0)) return { max: 1, step: 0.2 };
  const raw = v / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  return { max: Math.ceil((v * 1.04) / step) * step, step };
}

export function niceRange(lo: number, hi: number, ticks = 4): { min: number; max: number; step: number } {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1, step: 0.25 };
  if (hi - lo < 1e-6) {
    hi = lo + Math.max(1, Math.abs(lo) * 0.1);
    lo = lo - Math.max(1, Math.abs(lo) * 0.1);
  }
  const raw = (hi - lo) / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step, step };
}

export function ticksFor(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  for (let v = min; v <= max + step * 1e-6; v += step) out.push(+v.toFixed(6));
  return out;
}

/** Chart colour tokens (light surface; series >= 3:1 on white). Power uses the app accent. */
export const C = {
  power: '#d9480f',
  torque: '#2563eb',
  secondary: '#a16207',
  aqua: '#0f9d75',
  violet: '#7c3aed',
  magenta: '#db2777',
  critical: '#dc2626',
  grid: 'rgba(15,23,42,0.08)',
  axis: '#66707e',
  cursor: 'rgba(15,23,42,0.5)',
};

/** Snapshot colours by slot (stable per snapshot). */
export const SNAP_COLORS = [C.aqua, C.violet, C.magenta];

export const AXIS_TICK = { fill: '#566070', fontSize: 10, fontFamily: 'var(--mono)' };
