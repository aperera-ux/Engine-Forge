import { memo, type ReactNode } from 'react';

interface Props {
  rpm: number;
  redline: number;
  /** Gauge maximum, rpm. */
  max: number;
  size?: number;
  dyno?: boolean;
}

const START = -225; // deg, measured clockwise from 3 o'clock... we use SVG math below
const SWEEP = 270;

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Static face (ticks, numerals, redline band) — memoised; only the needle moves. */
const Face = memo(function Face({ redline, max, size }: { redline: number; max: number; size: number }) {
  const c = size / 2;
  const R = c - 6;
  const a0 = START + 90; // -135 from top
  const toAng = (rpm: number) => a0 + (rpm / max) * SWEEP;
  const majorStep = max > 12000 ? 2000 : 1000;
  const ticks: ReactNode[] = [];
  for (let r = 0; r <= max + 1; r += majorStep / 4) {
    const major = r % majorStep === 0;
    const ang = toAng(r);
    const [x0, y0] = polar(c, c, R - 2, ang);
    const [x1, y1] = polar(c, c, R - (major ? 11 : 6), ang);
    ticks.push(
      <line key={`t${r}`} x1={x0} y1={y0} x2={x1} y2={y1} className={`tick ${major ? 'major' : ''} ${r >= redline ? 'red' : ''}`} />,
    );
    if (major) {
      const [tx, ty] = polar(c, c, R - 22, ang);
      ticks.push(
        <text key={`n${r}`} x={tx} y={ty} className={`num ${r >= redline ? 'red' : ''}`} textAnchor="middle" dominantBaseline="central">
          {r / 1000}
        </text>,
      );
    }
  }
  return (
    <g>
      <circle cx={c} cy={c} r={R + 3} className="bezel" />
      <path d={arc(c, c, R - 1, a0, a0 + SWEEP)} className="track" />
      <path d={arc(c, c, R - 1, toAng(redline), a0 + SWEEP)} className="redzone" />
      {ticks}
      <text x={c} y={c + R * 0.62} textAnchor="middle" className="x1000">
        ×1000 rpm
      </text>
    </g>
  );
});

export function Tachometer({ rpm, redline, max, size = 168, dyno }: Props) {
  const c = size / 2;
  const R = c - 6;
  const a0 = START + 90;
  const ang = a0 + (Math.min(rpm, max) / max) * SWEEP;
  const [nx, ny] = polar(c, c, R - 8, ang);
  const [bx, by] = polar(c, c, 12, ang + 180);
  const over = rpm >= redline - 50;
  return (
    <svg className={`tach ${over ? 'over' : ''} ${dyno ? 'dyno' : ''}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} data-testid="tach">
      <defs>
        <radialGradient id="tachbg" cx="50%" cy="40%" r="65%">
          <stop offset="0%" stopColor="#1c1d21" stopOpacity="0.72" />
          <stop offset="100%" stopColor="#0b0c0e" stopOpacity="0.82" />
        </radialGradient>
      </defs>
      <circle cx={c} cy={c} r={R + 2} fill="url(#tachbg)" />
      <Face redline={redline} max={max} size={size} />
      <path d={arc(c, c, R - 1, a0, Math.max(a0 + 0.01, ang))} className="sweep" />
      <line x1={bx} y1={by} x2={nx} y2={ny} className="needle" />
      <circle cx={c} cy={c} r={5} className="hub" />
      <text x={c} y={c + R * 0.36} textAnchor="middle" className="readout">
        {Math.round(rpm).toLocaleString('en-US')}
      </text>
    </svg>
  );
}
