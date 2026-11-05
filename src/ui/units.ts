/** Unit handling. Internal values are always SI-ish (as in types.ts); this converts for display. */
export type Units = 'metric' | 'imperial';

export type Quantity =
  | 'length' // mm
  | 'lift' // mm (valve lift; shown in inches in imperial)
  | 'pressure' // bar
  | 'temp' // °C
  | 'mass' // kg
  | 'speed' // m/s (piston speed)
  | 'power' // kW
  | 'torque' // N·m
  | 'area' // m²
  | 'none';

interface Conv {
  label: string;
  to: (v: number) => number;
  from: (v: number) => number;
  /** Extra decimals vs metric representation. */
  extraDecimals: number;
}

const id = (v: number) => v;

const METRIC: Record<Quantity, Conv> = {
  length: { label: 'mm', to: id, from: id, extraDecimals: 0 },
  lift: { label: 'mm', to: id, from: id, extraDecimals: 0 },
  pressure: { label: 'bar', to: id, from: id, extraDecimals: 0 },
  temp: { label: '°C', to: id, from: id, extraDecimals: 0 },
  mass: { label: 'kg', to: id, from: id, extraDecimals: 0 },
  speed: { label: 'm/s', to: id, from: id, extraDecimals: 0 },
  power: { label: 'kW', to: id, from: id, extraDecimals: 0 },
  torque: { label: 'N·m', to: id, from: id, extraDecimals: 0 },
  area: { label: 'm²', to: id, from: id, extraDecimals: 0 },
  none: { label: '', to: id, from: id, extraDecimals: 0 },
};

const IMPERIAL: Record<Quantity, Conv> = {
  length: { label: 'in', to: (v) => v / 25.4, from: (v) => v * 25.4, extraDecimals: 2 },
  lift: { label: 'in', to: (v) => v / 25.4, from: (v) => v * 25.4, extraDecimals: 2 },
  pressure: { label: 'psi', to: (v) => v * 14.5038, from: (v) => v / 14.5038, extraDecimals: -1 },
  temp: { label: '°F', to: (v) => (v * 9) / 5 + 32, from: (v) => ((v - 32) * 5) / 9, extraDecimals: 0 },
  mass: { label: 'lb', to: (v) => v * 2.20462, from: (v) => v / 2.20462, extraDecimals: 0 },
  speed: { label: 'ft/min', to: (v) => v * 196.85, from: (v) => v / 196.85, extraDecimals: -2 },
  power: { label: 'hp', to: (v) => (v * 1000) / 745.7, from: (v) => (v * 745.7) / 1000, extraDecimals: 0 },
  torque: { label: 'lb·ft', to: (v) => v * 0.737562, from: (v) => v / 0.737562, extraDecimals: 0 },
  area: { label: 'ft²', to: (v) => v * 10.7639, from: (v) => v / 10.7639, extraDecimals: 0 },
  none: { label: '', to: id, from: id, extraDecimals: 0 },
};

export function conv(q: Quantity, units: Units): Conv {
  return (units === 'metric' ? METRIC : IMPERIAL)[q];
}

export function fmt(v: number, decimals = 0): string {
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', {
    minimumFractionDigits: Math.max(0, decimals),
    maximumFractionDigits: Math.max(0, decimals),
  });
}

/** Format an SI value in the active unit system. Returns [number, unit]. */
export function show(v: number, q: Quantity, units: Units, metricDecimals = 0): [string, string] {
  const c = conv(q, units);
  return [fmt(c.to(v), Math.max(0, metricDecimals + c.extraDecimals)), c.label];
}

export function decimalsForStep(step: number): number {
  if (step >= 1) return 0;
  return Math.min(4, Math.ceil(-Math.log10(step) - 1e-9));
}
