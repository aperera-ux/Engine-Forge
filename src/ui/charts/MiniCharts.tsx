import { memo, useMemo } from 'react';
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import type { DynoPoint, SimResult } from '../../sim/types';
import { curveAt, useStore } from '../store';
import { conv, fmt, type Quantity, type Units } from '../units';
import { AXIS_TICK, C, niceRange, ticksFor, useSize } from './common';

interface SeriesDef {
  key: keyof DynoPoint;
  label: string;
  color: string;
  /** Optional transform before unit conversion (e.g. VE → %). */
  scale?: number;
  dashed?: boolean;
}

interface MiniDef {
  id: string;
  title: string;
  q: Quantity;
  unit?: string;
  decimals: number;
  series: SeriesDef[];
  /** Hide when this returns false. */
  when?: (r: SimResult) => boolean;
  zeroBased?: boolean;
}

const DEFS: MiniDef[] = [
  { id: 've', title: 'Vol. efficiency', q: 'none', unit: '%', decimals: 0, series: [{ key: 'volumetricEfficiency', label: 'VE', color: C.power, scale: 100 }] },
  {
    id: 'mep', title: 'BMEP / FMEP', q: 'pressure', decimals: 1, zeroBased: true,
    series: [
      { key: 'bmepBar', label: 'BMEP', color: C.torque },
      { key: 'fmepBar', label: 'FMEP', color: C.secondary, dashed: true },
    ],
  },
  {
    id: 'map', title: 'MAP / Boost', q: 'pressure', decimals: 2,
    series: [
      { key: 'mapBar', label: 'MAP', color: C.torque },
      { key: 'boostBar', label: 'Boost', color: C.power, dashed: true },
    ],
  },
  { id: 'bsfc', title: 'BSFC', q: 'none', unit: 'g/kWh', decimals: 0, series: [{ key: 'bsfcGkWh', label: 'BSFC', color: C.aqua }] },
  {
    id: 'spark', title: 'Spark / Knock', q: 'none', unit: '°', decimals: 1, zeroBased: true,
    series: [
      { key: 'sparkAdvanceDeg', label: 'Adv', color: C.torque },
      { key: 'knockRetardDeg', label: 'Knock', color: C.critical, dashed: true },
    ],
  },
  { id: 'egt', title: 'EGT', q: 'temp', decimals: 0, series: [{ key: 'egtC', label: 'EGT', color: C.magenta }] },
];

export function MiniCharts() {
  return (
    <div className="minis" data-testid="mini-charts">
      {DEFS.map((d) => (
        <MiniChart key={d.id} def={d} />
      ))}
    </div>
  );
}

function MiniChart({ def }: { def: MiniDef }) {
  const result = useStore((s) => s.result);
  const units = useStore((s) => s.units);
  const rpm = useStore((s) => s.rpm);
  const [ref, size] = useSize<HTMLDivElement>();
  const c = conv(def.q, units);
  const unit = def.unit ?? c.label;
  const dec = Math.max(0, def.decimals + c.extraDecimals);
  const now = def.series.map((s) => c.to(curveAt(result, rpm, s.key) * (s.scale ?? 1)));
  return (
    <div className="mini panel-inset">
      <div className="mini-h">
        <span className="mini-title">{def.title}</span>
        <span className="mini-unit">{unit}</span>
      </div>
      <div className="mini-now">
        {def.series.map((s, i) => (
          <span key={s.key} className="mini-val">
            {def.series.length > 1 && <i className={s.dashed ? 'dash' : ''} style={s.dashed ? { color: s.color } : { background: s.color }} />}
            {def.series.length > 1 && <em>{s.label}</em>}
            <b>{fmt(now[i], dec)}</b>
          </span>
        ))}
      </div>
      <div className="mini-plot" ref={ref}>
        {size.w > 0 && size.h > 0 && <MiniPlot def={def} result={result} units={units} w={size.w} h={size.h} rpm={rpm} />}
      </div>
    </div>
  );
}

const MM = { top: 4, right: 4, bottom: 0, left: 0 };
const MYW = 30;

const MiniPlot = memo(function MiniPlot({ def, result, units, w, h, rpm }: { def: MiniDef; result: SimResult; units: Units; w: number; h: number; rpm: number }) {
  const c = conv(def.q, units);
  const { rows, dom } = useMemo(() => {
    const rows = result.curve.map((p) => {
      const r: Record<string, number> = { rpm: p.rpm };
      def.series.forEach((s) => (r[s.key] = c.to((p[s.key] as number) * (s.scale ?? 1))));
      return r;
    });
    const vals = rows.flatMap((r) => def.series.map((s) => r[s.key]));
    let lo = Math.min(...vals);
    const hi = Math.max(...vals);
    if (def.zeroBased) lo = Math.min(0, lo);
    return { rows, dom: niceRange(lo, hi, 3) };
  }, [result, units, def, c]);
  const lo = result.curve[0]?.rpm ?? 0;
  const hi = result.curve[result.curve.length - 1]?.rpm ?? 1;
  const x0 = MM.left + MYW;
  const x1 = w - MM.right;
  const cx = x0 + ((Math.min(Math.max(rpm, lo), hi) - lo) / (hi - lo || 1)) * (x1 - x0);
  const dec = Math.max(0, (dom.step < 1 ? 1 : 0) + (dom.step < 0.1 ? 1 : 0));
  return (
    <>
      <StaticMini rows={rows} dom={dom} def={def} w={w} h={h} lo={lo} hi={hi} dec={dec} />
      <svg className="chart-overlay" width={w} height={h}>
        <line x1={cx} x2={cx} y1={MM.top} y2={h} className="cursor-line thin" />
      </svg>
    </>
  );
}, (a, b) => a.result === b.result && a.units === b.units && a.w === b.w && a.h === b.h && a.rpm === b.rpm);

const StaticMini = memo(function StaticMini({ rows, dom, def, w, h, lo, hi, dec }: { rows: Record<string, number>[]; dom: { min: number; max: number; step: number }; def: MiniDef; w: number; h: number; lo: number; hi: number; dec: number }) {
  return (
    <LineChart width={w} height={h} data={rows} margin={MM}>
      <CartesianGrid stroke={C.grid} vertical={false} />
      <XAxis dataKey="rpm" type="number" domain={[lo, hi]} hide />
      <YAxis
        width={MYW}
        domain={[dom.min, dom.max]}
        ticks={ticksFor(dom.min, dom.max, dom.step)}
        tick={{ ...AXIS_TICK, fontSize: 9 }}
        tickLine={false}
        axisLine={false}
        tickFormatter={(v: number) => v.toFixed(dec)}
      />
      <Tooltip
        isAnimationActive={false}
        cursor={{ stroke: 'rgba(255,255,255,0.15)' }}
        content={({ active, payload, label }) =>
          active && payload?.length ? (
            <div className="chart-tip sm">
              <div className="chart-tip-h">{fmt(Number(label))} rpm</div>
              {payload.map((p) => (
                <div className="chart-tip-row" key={String(p.dataKey)}>
                  <i style={{ background: String(p.stroke ?? p.color) }} />
                  <span>{def.series.find((s) => s.key === p.dataKey)?.label}</span>
                  <b>{fmt(Number(p.value), Math.max(dec, 1))}</b>
                </div>
              ))}
            </div>
          ) : null
        }
      />
      {def.series.map((s) => (
        <Line key={s.key} dataKey={s.key} stroke={s.color} strokeWidth={1.75} strokeDasharray={s.dashed ? '4 3' : undefined} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} isAnimationActive={false} />
      ))}
    </LineChart>
  );
});
