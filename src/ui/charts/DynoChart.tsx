import { memo, useMemo } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from 'recharts';
import type { DynoPoint, SimResult } from '../../sim/types';
import { curveAt, useStore, type Snapshot } from '../store';
import { conv, fmt, type Units } from '../units';
import { AXIS_TICK, C, SNAP_COLORS, niceMax, ticksFor, useSize } from './common';
import { measuredForChart, useCalib } from '../calibrateStore';

/** A measured / fitted overlay curve (SI units, same rpm order). */
interface Overlay {
  rpm: number[];
  torqueNm: number[];
  powerKw: number[];
}

function overlayAt(o: Overlay, rpm: number, key: 'torqueNm' | 'powerKw'): number | undefined {
  const n = o.rpm.length;
  if (!n || rpm < o.rpm[0] - 1e-6 || rpm > o.rpm[n - 1] + 1e-6) return undefined;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (o.rpm[m] <= rpm) lo = m;
    else hi = m;
  }
  const t = (rpm - o.rpm[lo]) / (o.rpm[hi] - o.rpm[lo] || 1);
  return o[key][lo] + (o[key][hi] - o[key][lo]) * t;
}

const M = { top: 14, right: 6, bottom: 0, left: 0 };
const YW = 46;
const XH = 24;

interface Row {
  rpm: number;
  [k: string]: number | [number, number] | undefined;
}

function sample(r: SimResult, rpm: number, key: 'powerKw' | 'torqueNm'): number | undefined {
  const c = r.curve;
  if (!c.length || rpm < c[0].rpm - 1 || rpm > c[c.length - 1].rpm + 1) return undefined;
  return curveAt(r, rpm, key);
}

function sampleCurve(c: DynoPoint[], rpm: number, key: 'powerKw' | 'torqueNm'): number | undefined {
  if (!c.length || rpm < c[0].rpm - 1 || rpm > c[c.length - 1].rpm + 1) return undefined;
  return curveAt({ curve: c } as SimResult, rpm, key);
}

/** Linear interpolation of a per-curve-point array (same order as result.curve). */
function pctAt(result: SimResult, arr: number[] | undefined, rpm: number): number | undefined {
  const c = result.curve;
  if (!arr || arr.length !== c.length || !c.length) return undefined;
  if (rpm <= c[0].rpm) return arr[0];
  if (rpm >= c[c.length - 1].rpm) return arr[arr.length - 1];
  let i = 1;
  while (i < c.length - 1 && c[i].rpm < rpm) i++;
  const t = (rpm - c[i - 1].rpm) / (c[i].rpm - c[i - 1].rpm || 1);
  return arr[i - 1] + (arr[i] - arr[i - 1]) * t;
}

function buildRows(result: SimResult, snaps: Snapshot[], units: Units, showUnlimited: boolean, meas: Overlay | null, preview: Overlay | null) {
  const all = [result, ...snaps.map((s) => s.result)];
  const lo = Math.min(...all.map((r) => r.curve[0]?.rpm ?? 0), ...(meas ? [meas.rpm[0]] : []));
  const hi = Math.max(...all.map((r) => r.curve[r.curve.length - 1]?.rpm ?? 1), ...(meas ? [meas.rpm[meas.rpm.length - 1]] : []));
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
    const pct = pctAt(result, result.uncertainty?.torquePct, rpm);
    if (pct !== undefined && row.p !== undefined && row.t !== undefined) {
      row.pPct = pct;
      row.bandP = [row.p * (1 - pct / 100), row.p * (1 + pct / 100)];
      row.bandT = [row.t * (1 - pct / 100), row.t * (1 + pct / 100)];
    }
    if (showUnlimited && result.unlimited) {
      const up = sampleCurve(result.unlimited, rpm, 'powerKw');
      const ut = sampleCurve(result.unlimited, rpm, 'torqueNm');
      row.unP = up === undefined ? undefined : P(up);
      row.unT = ut === undefined ? undefined : T(ut);
    }
    if (meas) {
      // Only at the measured points themselves (so they draw as markers), never interpolated between them.
      if (meas.rpm.includes(rpm)) {
        const mt = overlayAt(meas, rpm, 'torqueNm');
        const mp = overlayAt(meas, rpm, 'powerKw');
        row.mT = mt === undefined ? undefined : T(mt);
        row.mP = mp === undefined ? undefined : P(mp);
      }
    }
    if (preview) {
      const ft = overlayAt(preview, rpm, 'torqueNm');
      const fp = overlayAt(preview, rpm, 'powerKw');
      row.fT = ft === undefined ? undefined : T(ft);
      row.fP = fp === undefined ? undefined : P(fp);
    }
    snaps.forEach((s) => {
      const sp = sample(s.result, rpm, 'powerKw');
      const st = sample(s.result, rpm, 'torqueNm');
      row[`p_${s.id}`] = sp === undefined ? undefined : P(sp);
      row[`t_${s.id}`] = st === undefined ? undefined : T(st);
    });
    rows.push(row);
  };
  const grid = new Set<number>();
  for (let rpm = lo; rpm < hi; rpm += step) grid.add(rpm);
  grid.add(hi);
  meas?.rpm.forEach((r) => grid.add(r));
  [...grid].sort((a, b) => a - b).forEach(pushRow);
  let pMax = 0;
  let tMax = 0;
  rows.forEach((r) => {
    for (const k in r) {
      const v = r[k];
      if (k === 'rpm' || k === 'pPct' || v === undefined) continue;
      const hi = Array.isArray(v) ? v[1] : v;
      if (k === 'bandP' || k.startsWith('p') || k === 'unP' || k === 'mP' || k === 'fP') pMax = Math.max(pMax, hi);
      else if (k === 'bandT' || k.startsWith('t') || k === 'unT' || k === 'mT' || k === 'fT') tMax = Math.max(tMax, hi);
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
  const showUnlimited = useStore((s) => s.showUnlimited);
  const imported = useCalib((s) => s.imported);
  const fitPreview = useCalib((s) => s.fit);
  const calibration = useStore((s) => s.calibration);
  const meas = useMemo(() => measuredForChart(imported, calibration), [imported, calibration]);
  // A fitted-but-not-applied curve is previewed as a dashed line; once applied it IS the model line.
  const preview = useMemo<Overlay | null>(
    () => (fitPreview ? { rpm: fitPreview.series.rpm, torqueNm: fitPreview.series.afterNm, powerKw: fitPreview.series.afterNm.map((t, i) => (t * fitPreview.series.rpm[i]) / 9549.297) } : null),
    [fitPreview],
  );
  const data = useMemo(() => buildRows(result, snapshots, units, showUnlimited, meas, preview), [result, snapshots, units, showUnlimited, meas, preview]);
  const pu = conv('power', units).label;
  const tu = conv('torque', units).label;
  return (
    <div className="dyno-chart" ref={ref} data-testid="dyno-chart">
      {size.w > 0 && size.h > 0 && (
        <>
          <StaticChart data={data} snapshots={snapshots} w={size.w} h={size.h} pu={pu} tu={tu} showUnlimited={showUnlimited && !!result.unlimited} hasMeasured={!!meas} hasPreview={!!preview} />
          <CursorOverlay data={data} w={size.w} h={size.h} result={result} units={units} />
        </>
      )}
    </div>
  );
}

type Data = ReturnType<typeof buildRows>;

const StaticChart = memo(function StaticChart({ data, snapshots, w, h, pu, tu, showUnlimited, hasMeasured, hasPreview }: { data: Data; snapshots: Snapshot[]; w: number; h: number; pu: string; tu: string; showUnlimited: boolean; hasMeasured: boolean; hasPreview: boolean }) {
  const setRpm = useStore((s) => s.setRpm);
  return (
    <ComposedChart
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
        axisLine={{ stroke: '#cfd5de' }}
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
        cursor={{ stroke: 'rgba(15,23,42,0.3)', strokeWidth: 1 }}
        isAnimationActive={false}
      />
      {/* ±1σ prediction band (behind the lines) */}
      <Area yAxisId="t" dataKey="bandT" stroke="none" fill={C.torque} fillOpacity={0.16} dot={false} activeDot={false} isAnimationActive={false} legendType="none" tooltipType="none" />
      <Area yAxisId="p" dataKey="bandP" stroke="none" fill={C.power} fillOpacity={0.16} dot={false} activeDot={false} isAnimationActive={false} legendType="none" tooltipType="none" />
      {showUnlimited && <Line yAxisId="t" dataKey="unT" stroke={C.torque} strokeWidth={1.75} strokeDasharray="7 4" dot={false} activeDot={false} isAnimationActive={false} />}
      {showUnlimited && <Line yAxisId="p" dataKey="unP" stroke={C.power} strokeWidth={1.75} strokeDasharray="7 4" dot={false} activeDot={false} isAnimationActive={false} />}
      {snapshots.map((s) => (
        <Line key={`p_${s.id}`} yAxisId="p" dataKey={`p_${s.id}`} stroke={SNAP_COLORS[s.slot]} strokeOpacity={0.75} strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={false} isAnimationActive={false} connectNulls={false} />
      ))}
      {snapshots.map((s) => (
        <Line key={`t_${s.id}`} yAxisId="t" dataKey={`t_${s.id}`} stroke={SNAP_COLORS[s.slot]} strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="2 4" dot={false} activeDot={false} isAnimationActive={false} connectNulls={false} />
      ))}
      {hasPreview && <Line yAxisId="t" dataKey="fT" stroke={C.torque} strokeWidth={2} strokeDasharray="6 3" dot={false} activeDot={false} isAnimationActive={false} />}
      {hasPreview && <Line yAxisId="p" dataKey="fP" stroke={C.power} strokeWidth={2} strokeDasharray="6 3" dot={false} activeDot={false} isAnimationActive={false} />}
      <Line yAxisId="t" dataKey="t" name="Torque" stroke={C.torque} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#ffffff' }} isAnimationActive={false} />
      <Line yAxisId="p" dataKey="p" name="Power" stroke={C.power} strokeWidth={2.25} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#ffffff' }} isAnimationActive={false} />
      {hasMeasured && <Line yAxisId="p" dataKey="mP" stroke={MEAS} strokeOpacity={0.55} strokeWidth={1.25} connectNulls dot={{ r: 2.2, fill: '#ffffff', stroke: MEAS, strokeWidth: 1.4 }} activeDot={false} isAnimationActive={false} />}
      {hasMeasured && <Line yAxisId="t" dataKey="mT" stroke={MEAS} strokeWidth={1.5} connectNulls dot={{ r: 2.6, fill: MEAS, stroke: '#ffffff', strokeWidth: 0.8 }} activeDot={false} isAnimationActive={false} />}
    </ComposedChart>
  );
});

/** Measured-curve colour: neutral dark, distinct from the torque / power / snapshot hues. */
const MEAS = '#1f2937';

interface TipProps {
  active?: boolean;
  label?: number | string;
  payload?: { dataKey?: string | number; value?: unknown }[];
  snapshots: Snapshot[];
  pu: string;
  tu: string;
}

function DynoTooltip({ active, label, payload, snapshots, pu, tu }: TipProps) {
  if (!active || !payload?.length) return null;
  const get = (k: string) => {
    const v = payload.find((p) => p.dataKey === k)?.value;
    return typeof v === 'number' ? v : undefined;
  };
  const pct = (payload[0] as { payload?: Row } | undefined)?.payload?.pPct;
  const mT = get('mT');
  const mP = get('mP');
  const unP = get('unP');
  const unT = get('unT');
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
      {mT !== undefined && mP !== undefined && (
        <div className="chart-tip-row" data-testid="measured-tip">
          <i style={{ background: MEAS }} />
          <span>Measured</span>
          <b>
            {fmt(mP)} <small>{pu}</small> / {fmt(mT)} <small>{tu}</small>
            {t !== undefined && mT > 0 && <small> ({t - mT >= 0 ? '+' : '−'}{Math.abs(((t - mT) / mT) * 100).toFixed(1)} %)</small>}
          </b>
        </div>
      )}
      {typeof pct === 'number' && (
        <div className="chart-tip-row">
          <span>Model band (1σ)</span>
          <b>±{pct.toFixed(0)}%</b>
        </div>
      )}
      {unP !== undefined && unT !== undefined && (
        <div className="chart-tip-row">
          <span>Hardware-only</span>
          <b>
            {fmt(unP)} <small>{pu}</small> / {fmt(unT)} <small>{tu}</small>
          </b>
        </div>
      )}
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
  // OEM-style plateau: when an ECU limit holds the top, label the rpm range ("450 @ 1,600–4,800").
  const tR = result.peakTorqueRpmRange;
  const pR = result.peakPowerRpmRange;
  const tPlateau = !!tR && tR[1] - tR[0] > 1;
  const pPlateau = !!pR && pR[1] - pR[0] > 1;
  const tRpmTxt = tPlateau ? `${fmt(tR![0])}–${fmt(tR![1])}` : fmt(result.peakTorqueRpm);
  const pRpmTxt = pPlateau ? `${fmt(pR![0])}–${fmt(pR![1])}` : fmt(result.peakPowerRpm);
  const pk = { x: X(pPlateau ? (pR![0] + pR![1]) / 2 : result.peakPowerRpm), y: YP(P(result.peakPowerKw)) };
  const tk = { x: X(tPlateau ? (tR![0] + tR![1]) / 2 : result.peakTorqueRpm), y: YT(T(result.peakTorqueNm)) };
  return (
    <svg className="chart-overlay" width={w} height={h}>
      {dyno && <rect x={x0} y={y0} width={Math.max(0, cx - x0)} height={y1 - y0} className="sweep-bg" />}
      <g className="peak">
        {pPlateau && <line x1={X(pR![0])} x2={X(pR![1])} y1={pk.y} y2={pk.y} stroke={C.power} strokeOpacity={0.5} strokeWidth={4} strokeLinecap="round" />}
        <line x1={pk.x} x2={pk.x} y1={pk.y + 6} y2={y1} stroke={C.power} strokeOpacity={0.35} strokeDasharray="2 3" />
        <circle cx={pk.x} cy={pk.y} r={4} fill="#ffffff" stroke={C.power} strokeWidth={2} />
        <text x={Math.min(pk.x, x1 - 4)} y={pk.y - 8} textAnchor={pk.x > x1 - 60 ? 'end' : 'middle'} className="peak-label" data-testid="peak-power-label">
          {fmt(P(result.peakPowerKw))} @ {pRpmTxt}
        </text>
        {tPlateau && <line x1={X(tR![0])} x2={X(tR![1])} y1={tk.y} y2={tk.y} stroke={C.torque} strokeOpacity={0.5} strokeWidth={4} strokeLinecap="round" />}
        <line x1={tk.x} x2={tk.x} y1={tk.y + 6} y2={y1} stroke={C.torque} strokeOpacity={0.35} strokeDasharray="2 3" />
        <circle cx={tk.x} cy={tk.y} r={4} fill="#ffffff" stroke={C.torque} strokeWidth={2} />
        <text x={Math.max(tk.x, x0 + 4)} y={tk.y - 8} textAnchor={tk.x < x0 + 60 ? 'start' : 'middle'} className="peak-label" data-testid="peak-torque-label">
          {fmt(T(result.peakTorqueNm))} @ {tRpmTxt}
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
