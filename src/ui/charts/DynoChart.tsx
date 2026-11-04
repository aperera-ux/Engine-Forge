import { memo, useMemo } from 'react';
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import type { SimResult } from '../../sim/types';
import { curveAt, useStore, type Snapshot } from '../store';
import { conv, fmt, type Units } from '../units';
import { AXIS_TICK, C, SNAP_COLORS, niceMax, ticksFor, useSize } from './common';

const M = { top: 14, right: 6, bottom: 0, left: 0 };
const YW = 46;
const XH = 24;

interface Row {
  rpm: number;
  [k: string]: number | undefined;
}

function sample(r: SimResult, rpm: number, key: 'powerKw' | 'torqueNm'): number | undefined {
  const c = r.curve;
  if (!c.length || rpm < c[0].rpm - 1 || rpm > c[c.length - 1].rpm + 1) return undefined;
  return curveAt(r, rpm, key);
}

function buildRows(result: SimResult, snaps: Snapshot[], units: Units) {
  const all = [result, ...snaps.map((s) => s.result)];
  const lo = Math.min(...all.map((r) => r.curve[0]?.rpm ?? 0));
  const hi = Math.max(...all.map((r) => r.curve[r.curve.length - 1]?.rpm ?? 1));
  const step = Math.max(50, Math.round((hi - lo) / 120 / 50) * 50);
  const P = conv('power', units).to;
  const T = conv('torque', units).to;
  const rows: Row[] = [];
  const pushRow = (rpm: number) => {
    const row: Row = { rpm };
    const p = sample(result, rpm, 'powerKw');
    const t = sample(result, rpm, 'torqueNm');
    row.p = p === undefined ? undefined : P(p);
    row.t = t === undefined ? undefined : T(t);
    snaps.forEach((s) => {
      const sp = sample(s.result, rpm, 'powerKw');
      const st = sample(s.result, rpm, 'torqueNm');
      row[`p_${s.id}`] = sp === undefined ? undefined : P(sp);
      row[`t_${s.id}`] = st === undefined ? undefined : T(st);
    });
    rows.push(row);
  };
  for (let rpm = lo; rpm < hi; rpm += step) pushRow(rpm);
  pushRow(hi);
  let pMax = 0;
  let tMax = 0;
  rows.forEach((r) => {
    for (const k in r) {
      if (k.startsWith('p') && r[k] !== undefined) pMax = Math.max(pMax, r[k]!);
      if (k.startsWith('t') && r[k] !== undefined) tMax = Math.max(tMax, r[k]!);
    }
  });
  return { rows, lo, hi, pAxis: niceMax(pMax), tAxis: niceMax(tMax) };
}

function rpmTicks(lo: number, hi: number): number[] {
  const step = hi - lo > 12000 ? 2000 : 1000;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

export function DynoChart() {
  const result = useStore((s) => s.result);
  const snapshots = useStore((s) => s.snapshots);
  const units = useStore((s) => s.units);
  const [ref, size] = useSize<HTMLDivElement>();
  const data = useMemo(() => buildRows(result, snapshots, units), [result, snapshots, units]);
  const pu = conv('power', units).label;
  const tu = conv('torque', units).label;
  return (
    <div className="dyno-chart" ref={ref} data-testid="dyno-chart">
      {size.w > 0 && size.h > 0 && (
        <>
          <StaticChart data={data} snapshots={snapshots} w={size.w} h={size.h} pu={pu} tu={tu} />
          <CursorOverlay data={data} w={size.w} h={size.h} result={result} units={units} />
        </>
      )}
    </div>
  );
}

type Data = ReturnType<typeof buildRows>;

const StaticChart = memo(function StaticChart({ data, snapshots, w, h, pu, tu }: { data: Data; snapshots: Snapshot[]; w: number; h: number; pu: string; tu: string }) {
  const setRpm = useStore((s) => s.setRpm);
  return (
    <LineChart
      width={w}
      height={h}
      data={data.rows}
      margin={M}
      onClick={(e) => {
        const label = (e as { activeLabel?: number | string } | null)?.activeLabel;
        if (label != null && !useStore.getState().dynoActive) setRpm(Number(label));
      }}
    >
      <CartesianGrid stroke={C.grid} vertical={false} yAxisId="p" />
      <XAxis
        dataKey="rpm"
        type="number"
        domain={[data.lo, data.hi]}
        tick={AXIS_TICK}
        tickLine={false}
        axisLine={{ stroke: 'rgba(255,255,255,0.12)' }}
        height={XH}
        tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : `${v}`)}
        ticks={rpmTicks(data.lo, data.hi)}
      />
      <YAxis
        yAxisId="p"
        width={YW}
        domain={[0, data.pAxis.max]}
        ticks={ticksFor(0, data.pAxis.max, data.pAxis.step)}
        tick={AXIS_TICK}
        tickLine={false}
        axisLine={false}
        label={{ value: pu, position: 'insideTopLeft', offset: 0, dy: -14, dx: 8, fill: C.power, fontSize: 10 }}
      />
      <YAxis
        yAxisId="t"
        orientation="right"
        width={YW}
        domain={[0, data.tAxis.max]}
        ticks={ticksFor(0, data.tAxis.max, data.tAxis.step)}
        tick={AXIS_TICK}
        tickLine={false}
        axisLine={false}
        label={{ value: tu, position: 'insideTopRight', offset: 0, dy: -14, dx: -6, fill: C.torque, fontSize: 10 }}
      />
      <Tooltip
        content={<DynoTooltip snapshots={snapshots} pu={pu} tu={tu} />}
        cursor={{ stroke: 'rgba(255,255,255,0.18)', strokeWidth: 1 }}
        isAnimationActive={false}
      />
      {snapshots.map((s) => (
        <Line key={`p_${s.id}`} yAxisId="p" dataKey={`p_${s.id}`} stroke={SNAP_COLORS[s.slot]} strokeOpacity={0.75} strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={false} isAnimationActive={false} connectNulls={false} />
      ))}
      {snapshots.map((s) => (
        <Line key={`t_${s.id}`} yAxisId="t" dataKey={`t_${s.id}`} stroke={SNAP_COLORS[s.slot]} strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="2 4" dot={false} activeDot={false} isAnimationActive={false} connectNulls={false} />
      ))}
      <Line yAxisId="t" dataKey="t" name="Torque" stroke={C.torque} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#121316' }} isAnimationActive={false} />
      <Line yAxisId="p" dataKey="p" name="Power" stroke={C.power} strokeWidth={2.25} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#121316' }} isAnimationActive={false} />
    </LineChart>
  );
});

interface TipProps {
  active?: boolean;
  label?: number | string;
  payload?: { dataKey?: string | number; value?: number }[];
  snapshots: Snapshot[];
  pu: string;
  tu: string;
}

function DynoTooltip({ active, label, payload, snapshots, pu, tu }: TipProps) {
  if (!active || !payload?.length) return null;
  const get = (k: string) => payload.find((p) => p.dataKey === k)?.value;
  const p = get('p');
  const t = get('t');
  return (
    <div className="chart-tip">
      <div className="chart-tip-h">{fmt(Number(label))} rpm</div>
      <div className="chart-tip-row">
        <i style={{ background: C.power }} />
        <span>Power</span>
        <b>
          {p !== undefined ? fmt(p) : '—'} <small>{pu}</small>
        </b>
      </div>
      <div className="chart-tip-row">
        <i style={{ background: C.torque }} />
        <span>Torque</span>
        <b>
          {t !== undefined ? fmt(t) : '—'} <small>{tu}</small>
        </b>
      </div>
      {snapshots.map((s) => {
        const sp = get(`p_${s.id}`);
        const st = get(`t_${s.id}`);
        if (sp === undefined || p === undefined) return null;
        return (
          <div className="chart-tip-row snap" key={s.id}>
            <i style={{ background: SNAP_COLORS[s.slot] }} />
            <span className="ellipsis">{s.name}</span>
            <b>
              <Delta v={p - sp} />
              {st !== undefined && t !== undefined && (
                <>
                  {' / '}
                  <Delta v={t - st} />
                </>
              )}
            </b>
          </div>
        );
      })}
    </div>
  );
}

export function Delta({ v, unit, decimals = 0 }: { v: number; unit?: string; decimals?: number }) {
  const cls = Math.abs(v) < 0.5 ? 'flat' : v > 0 ? 'up' : 'down';
  return (
    <span className={`delta ${cls}`}>
      {v > 0 ? '+' : v < 0 ? '−' : '±'}
      {fmt(Math.abs(v), decimals)}
      {unit && <small> {unit}</small>}
    </span>
  );
}

/** Lightweight SVG overlay for the moving rpm cursor + peak markers (keeps recharts static at 60 fps). */
function CursorOverlay({ data, w, h, result, units }: { data: Data; w: number; h: number; result: SimResult; units: Units }) {
  const rpm = useStore((s) => s.rpm);
  const dyno = useStore((s) => s.dynoActive);
  const x0 = M.left + YW;
  const x1 = w - M.right - YW;
  const y0 = M.top;
  const y1 = h - M.bottom - XH;
  const X = (r: number) => x0 + ((r - data.lo) / (data.hi - data.lo || 1)) * (x1 - x0);
  const YP = (v: number) => y1 - (v / data.pAxis.max) * (y1 - y0);
  const YT = (v: number) => y1 - (v / data.tAxis.max) * (y1 - y0);
  const P = conv('power', units).to;
  const T = conv('torque', units).to;
  const pNow = P(curveAt(result, rpm, 'powerKw'));
  const tNow = T(curveAt(result, rpm, 'torqueNm'));
  const cx = X(Math.min(Math.max(rpm, data.lo), data.hi));
  const pk = { x: X(result.peakPowerRpm), y: YP(P(result.peakPowerKw)) };
  const tk = { x: X(result.peakTorqueRpm), y: YT(T(result.peakTorqueNm)) };
  return (
    <svg className="chart-overlay" width={w} height={h}>
      {dyno && <rect x={x0} y={y0} width={Math.max(0, cx - x0)} height={y1 - y0} className="sweep-bg" />}
      <g className="peak">
        <line x1={pk.x} x2={pk.x} y1={pk.y + 6} y2={y1} stroke={C.power} strokeOpacity={0.35} strokeDasharray="2 3" />
        <circle cx={pk.x} cy={pk.y} r={4} fill="#121316" stroke={C.power} strokeWidth={2} />
        <text x={Math.min(pk.x, x1 - 4)} y={pk.y - 8} textAnchor={pk.x > x1 - 60 ? 'end' : 'middle'} className="peak-label">
          {fmt(P(result.peakPowerKw))} @ {fmt(result.peakPowerRpm)}
        </text>
        <line x1={tk.x} x2={tk.x} y1={tk.y + 6} y2={y1} stroke={C.torque} strokeOpacity={0.35} strokeDasharray="2 3" />
        <circle cx={tk.x} cy={tk.y} r={4} fill="#121316" stroke={C.torque} strokeWidth={2} />
        <text x={Math.max(tk.x, x0 + 4)} y={tk.y - 8} textAnchor={tk.x < x0 + 60 ? 'start' : 'middle'} className="peak-label">
          {fmt(T(result.peakTorqueNm))} @ {fmt(result.peakTorqueRpm)}
        </text>
      </g>
      <line x1={cx} x2={cx} y1={y0 - 4} y2={y1} className="cursor-line" />
      <circle cx={cx} cy={YP(pNow)} r={3.5} fill={C.power} className="cursor-dot" />
      <circle cx={cx} cy={YT(tNow)} r={3.5} fill={C.torque} className="cursor-dot" />
      <g transform={`translate(${Math.min(Math.max(cx, x0 + 26), x1 - 26)}, ${y1 + 2})`}>
        <rect x={-26} y={0} width={52} height={15} rx={3} className="cursor-chip" />
        <text x={0} y={11} textAnchor="middle" className="cursor-chip-t">
          {fmt(rpm)}
        </text>
      </g>
    </svg>
  );
}
