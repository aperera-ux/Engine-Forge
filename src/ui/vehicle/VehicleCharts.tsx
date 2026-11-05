/** The three vehicle charts: speed vs time, gear sawtooth (rpm vs speed), tractive effort per gear vs road load. */
import { memo, useMemo, type ReactNode } from 'react';
import { CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import { FOOT_M } from '../../vehicle/globals';
import { useStore } from '../store';
import { fmt, type Units } from '../units';
import { AXIS_TICK, C, niceMax, ticksFor, useSize } from '../charts/common';
import type { SimOutput } from './compute';
import { useVehicleSim } from './sim';

/** One hue per gear: a perceptual ramp from warm to cool, all >= 3:1 on white. */
export const GEAR_COLORS = ['#b91c1c', '#c2410c', '#a16207', '#4d7c0f', '#0f9d75', '#0e7490', '#2563eb', '#4f46e5', '#7c3aed', '#a21caf'];

const KPH_PER_MPH = 1.609344;
const N_PER_LBF = 4.4482216;
export const speedConv = (u: Units) => ({ to: (kph: number) => (u === 'metric' ? kph : kph / KPH_PER_MPH), label: u === 'metric' ? 'km/h' : 'mph' });
export const forceConv = (u: Units) => ({ to: (n: number) => (u === 'metric' ? n : n / N_PER_LBF), label: u === 'metric' ? 'N' : 'lbf' });

const M = { top: 12, right: 10, bottom: 0, left: 0 };
const YW = 46;

function ChartCard({ title, legend, children, testId, stale }: { title: string; legend?: ReactNode; children: (w: number, h: number) => ReactNode; testId: string; stale: boolean }) {
  const [ref, size] = useSize<HTMLDivElement>();
  return (
    <section className={`panel veh-card ${stale ? 'stale' : ''}`} data-testid={testId}>
      <div className="panel-h">
        <span className="panel-title">{title}</span>
        {legend && <div className="legend">{legend}</div>}
      </div>
      <div className="veh-plot" ref={ref}>
        {size.w > 0 && size.h > 0 && children(size.w, size.h)}
      </div>
    </section>
  );
}

const GearLegend = ({ n }: { n: number }) => (
  <>
    {Array.from({ length: n }, (_, i) => (
      <span className="lg" key={i}>
        <i style={{ background: GEAR_COLORS[i % GEAR_COLORS.length] }} />
        {i + 1}
      </span>
    ))}
  </>
);

interface SeriesPoint {
  t: number;
  v: number;
  rpm: number;
  gear: number;
}

/** Series relative to the timing start (after the 1-ft rollout when enabled), so chart times match the KPI tiles. */
function seriesPoints(out: SimOutput): SeriesPoint[] {
  const s = out.accel.series;
  if (!s) return [];
  let i0 = 0;
  if (out.accel.rollout) {
    while (i0 < s.t.length && s.distance[i0] < FOOT_M) i0++;
    if (i0 >= s.t.length) i0 = 0;
  }
  const t0 = s.t[i0];
  const pts: SeriesPoint[] = [];
  const every = Math.max(1, Math.floor(s.t.length / 400));
  const nextGear: number[] = new Array(s.t.length).fill(1);
  let ng = s.gear[s.t.length - 1] || 1;
  for (let i = s.t.length - 1; i >= 0; i--) {
    if (s.gear[i] > 0) ng = s.gear[i];
    nextGear[i] = ng;
  }
  for (let i = i0; i < s.t.length; i += every) {
    pts.push({ t: s.t[i] - t0, v: s.v[i] * 3.6, rpm: s.rpm[i], gear: nextGear[i] });
  }
  return pts;
}

function timeAxis(tEnd: number) {
  const step = tEnd <= 8 ? 1 : tEnd <= 20 ? 2 : 5;
  return { max: Math.ceil(tEnd / step) * step, step };
}

// ---- 1. speed vs time ---------------------------------------------------------
const SpeedTime = memo(function SpeedTime({ out, units, w, h }: { out: SimOutput; units: Units; w: number; h: number }) {
  const S = speedConv(units);
  const { rows, ymax, tmax } = useMemo(() => {
    const pts = seriesPoints(out);
    const rows = pts.map((p) => ({ t: p.t, s: S.to(p.v) }));
    return { rows, ymax: niceMax(Math.max(...rows.map((r) => r.s), 1)), tmax: timeAxis(rows[rows.length - 1]?.t ?? 1) };
  }, [out, units]);
  const mark60 = units === 'metric' ? 100 : 60;
  const markT = units === 'metric' ? out.accel.t0to100kph : out.accel.t0to60mph;
  const q = out.accel.quarterMileS;
  return (
    <ComposedChart width={w} height={h} data={rows} margin={M}>
      <CartesianGrid stroke={C.grid} vertical={false} />
      <XAxis dataKey="t" type="number" domain={[0, tmax.max]} ticks={ticksFor(0, tmax.max, tmax.step)} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: C.grid }} tickFormatter={(v: number) => (v >= tmax.max ? `${fmt(v)} s` : fmt(v))} height={24} />
      <YAxis width={YW} domain={[0, ymax.max]} ticks={ticksFor(0, ymax.max, ymax.step)} tick={AXIS_TICK} tickLine={false} axisLine={false} label={{ value: S.label, position: 'insideTopLeft', offset: 0, dy: -12, dx: 8, fill: C.torque, fontSize: 10 }} />
      <Tooltip
        isAnimationActive={false}
        cursor={{ stroke: 'rgba(15,23,42,0.3)' }}
        content={({ active, payload }) =>
          active && payload?.length ? (
            <div className="chart-tip sm">
              <div className="chart-tip-h">{fmt(Number(payload[0].payload.t), 2)} s</div>
              <div className="chart-tip-row">
                <i style={{ background: C.torque }} />
                <span>Speed</span>
                <b>
                  {fmt(Number(payload[0].value), 0)} <small>{S.label}</small>
                </b>
              </div>
            </div>
          ) : null
        }
      />
      {mark60 < ymax.max && <ReferenceLine y={mark60} stroke={C.axis} strokeDasharray="3 4" strokeOpacity={0.7} label={{ value: `${mark60}`, position: 'insideBottomLeft', fill: C.axis, fontSize: 9 }} />}
      {markT != null && <ReferenceLine x={markT} stroke={C.axis} strokeDasharray="3 4" strokeOpacity={0.7} />}
      {q != null && <ReferenceLine x={q} stroke={C.power} strokeDasharray="3 4" strokeOpacity={0.8} label={{ value: `1/4 mi ${q.toFixed(2)} s`, position: 'insideTopRight', fill: C.power, fontSize: 10 }} />}
      <Line dataKey="s" stroke={C.torque} strokeWidth={2.25} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} isAnimationActive={false} />
    </ComposedChart>
  );
});

// ---- 2. gear sawtooth -----------------------------------------------------------
const Sawtooth = memo(function Sawtooth({ out, units, w, h, nGears }: { out: SimOutput; units: Units; w: number; h: number; nGears: number }) {
  const S = speedConv(units);
  const { rows, xmax } = useMemo(() => {
    const pts = seriesPoints(out);
    const rows: Record<string, number | undefined>[] = [];
    pts.forEach((p, i) => {
      const r: Record<string, number | undefined> = { x: S.to(p.v), rpm: p.rpm, [`g${p.gear}`]: p.rpm };
      rows.push(r);
      // connect the shift drop: repeat the previous point in the new gear's series
      if (i > 0 && pts[i - 1].gear !== p.gear) rows[i - 1][`g${p.gear}`] = pts[i - 1].rpm;
    });
    return { rows, xmax: niceMax(Math.max(...rows.map((r) => r.x ?? 0), 1)) };
  }, [out, units]);
  const rl = out.redlineRpm;
  const ymax = niceMax(rl * 1.02, 5);
  return (
    <ComposedChart width={w} height={h} data={rows} margin={M}>
      <CartesianGrid stroke={C.grid} vertical={false} />
      <XAxis dataKey="x" type="number" domain={[0, xmax.max]} ticks={ticksFor(0, xmax.max, xmax.step)} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: C.grid }} height={24} tickFormatter={(v: number) => (v >= xmax.max ? `${fmt(v)} ${S.label}` : fmt(v))} />
      <YAxis width={YW} domain={[0, ymax.max]} ticks={ticksFor(0, ymax.max, ymax.step)} tick={AXIS_TICK} tickLine={false} axisLine={false} label={{ value: 'rpm', position: 'insideTopLeft', offset: 0, dy: -12, dx: 8, fill: C.axis, fontSize: 10 }} />
      <Tooltip
        isAnimationActive={false}
        cursor={{ stroke: 'rgba(15,23,42,0.3)' }}
        content={({ active, payload }) =>
          active && payload?.length ? (
            <div className="chart-tip sm">
              <div className="chart-tip-h">
                {fmt(Number(payload[0].payload.x))} {S.label}
              </div>
              <div className="chart-tip-row">
                <i style={{ background: C.axis }} />
                <span>Engine</span>
                <b>
                  {fmt(Number(payload[0].payload.rpm))} <small>rpm</small>
                </b>
              </div>
            </div>
          ) : null
        }
      />
      <ReferenceLine y={rl} stroke={C.critical} strokeDasharray="5 4" strokeOpacity={0.8} label={{ value: `limiter ${fmt(rl)}`, position: 'insideBottomRight', fill: C.critical, fontSize: 10 }} />
      {Array.from({ length: nGears }, (_, i) => (
        <Line key={i} dataKey={`g${i + 1}`} stroke={GEAR_COLORS[i % GEAR_COLORS.length]} strokeWidth={2} dot={false} activeDot={false} isAnimationActive={false} connectNulls={false} />
      ))}
    </ComposedChart>
  );
});

// ---- 3. tractive effort per gear vs road load -----------------------------------
const Tractive = memo(function Tractive({ out, units, w, h }: { out: SimOutput; units: Units; w: number; h: number }) {
  const S = speedConv(units);
  const F = forceConv(units);
  const { rows, xmax, ymax, gripOver } = useMemo(() => {
    const kmax = Math.max(out.roadLoad.kph[out.roadLoad.kph.length - 1], ...out.redlineKph) * 1.0;
    const xN = niceMax(S.to(kmax), 6);
    const N = 220;
    const interp = (xs: number[], ys: number[], x: number) => {
      if (x < xs[0] || x > xs[xs.length - 1]) return undefined;
      let i = 1;
      while (i < xs.length - 1 && xs[i] < x) i++;
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1] || 1);
      return ys[i - 1] + (ys[i] - ys[i - 1]) * t;
    };
    const rows: Record<string, number | undefined>[] = [];
    for (let k = 0; k <= N; k++) {
      const x = (xN.max * k) / N;
      const kph = units === 'metric' ? x : x * KPH_PER_MPH;
      const r: Record<string, number | undefined> = { x };
      out.gears.forEach((g) => {
        const f = interp(g.kph, g.n, kph);
        r[`g${g.gear}`] = f === undefined ? undefined : F.to(f);
      });
      const rl = interp(out.roadLoad.kph, out.roadLoad.n, kph);
      r.road = rl === undefined ? undefined : F.to(rl);
      rows.push(r);
    }
    const peak = Math.max(...out.gears.flatMap((g) => g.n.map((n) => F.to(n))), 1);
    const yN = niceMax(peak * 1.02, 5);
    return { rows, xmax: xN, ymax: yN, gripOver: F.to(out.gripFullN) > yN.max };
  }, [out, units]);
  const nG = out.gears.length;
  return (
    <ComposedChart width={w} height={h} data={rows} margin={M}>
      <CartesianGrid stroke={C.grid} vertical={false} />
      <XAxis dataKey="x" type="number" domain={[0, xmax.max]} ticks={ticksFor(0, xmax.max, xmax.step)} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: C.grid }} height={24} tickFormatter={(v: number) => (v >= xmax.max ? `${fmt(v)} ${S.label}` : fmt(v))} />
      <YAxis width={YW + 6} domain={[0, ymax.max]} ticks={ticksFor(0, ymax.max, ymax.step)} tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => fmt(v)} label={{ value: F.label, position: 'insideTopLeft', offset: 0, dy: -12, dx: 8, fill: C.axis, fontSize: 10 }} />
      <Tooltip
        isAnimationActive={false}
        cursor={{ stroke: 'rgba(15,23,42,0.3)' }}
        content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const row = payload[0].payload as Record<string, number | undefined>;
          return (
            <div className="chart-tip sm">
              <div className="chart-tip-h">
                {fmt(row.x ?? 0)} {S.label}
              </div>
              {out.gears.map((g) =>
                row[`g${g.gear}`] === undefined ? null : (
                  <div className="chart-tip-row" key={g.gear}>
                    <i style={{ background: GEAR_COLORS[(g.gear - 1) % GEAR_COLORS.length] }} />
                    <span>Gear {g.gear}</span>
                    <b>
                      {fmt(row[`g${g.gear}`] ?? 0)} <small>{F.label}</small>
                    </b>
                  </div>
                ),
              )}
              <div className="chart-tip-row snap">
                <i style={{ background: C.critical }} />
                <span>Road load</span>
                <b>
                  {fmt(row.road ?? 0)} <small>{F.label}</small>
                </b>
              </div>
            </div>
          );
        }}
      />
      {!gripOver && <ReferenceLine y={F.to(out.gripFullN)} stroke={C.secondary} strokeDasharray="6 4" label={{ value: 'tyre grip limit', position: 'insideTopRight', fill: C.secondary, fontSize: 10 }} />}
      {Array.from({ length: nG }, (_, i) => (
        <Line key={i} dataKey={`g${i + 1}`} stroke={GEAR_COLORS[i % GEAR_COLORS.length]} strokeWidth={2} dot={false} activeDot={false} isAnimationActive={false} connectNulls={false} />
      ))}
      <Line dataKey="road" stroke={C.critical} strokeWidth={2} strokeDasharray="2 3" dot={false} activeDot={false} isAnimationActive={false} />
      {out.top.speedKph > 0 && <ReferenceDot x={S.to(out.top.speedKph)} y={F.to(interpRoad(out, out.top.speedKph))} r={4} fill="#fff" stroke={C.critical} strokeWidth={2} />}
    </ComposedChart>
  );
});

function interpRoad(out: SimOutput, kph: number): number {
  const xs = out.roadLoad.kph;
  const ys = out.roadLoad.n;
  let i = 1;
  while (i < xs.length - 1 && xs[i] < kph) i++;
  const t = (kph - xs[i - 1]) / (xs[i] - xs[i - 1] || 1);
  return ys[i - 1] + (ys[i] - ys[i - 1]) * t;
}

export function VehicleCharts() {
  const out = useVehicleSim((s) => s.out);
  const stale = useVehicleSim((s) => s.stale);
  const err = useVehicleSim((s) => s.error);
  const units = useStore((s) => s.units);
  if (!out) return <div className="veh-center empty">{err ? `Vehicle model error: ${err}` : 'Computing…'}</div>;
  const nG = out.gears.length;
  const F = forceConv(units);
  const gripOver = out.gripFullN > 0 && F.to(out.gripFullN) > Math.max(...out.gears.flatMap((g) => g.n.map((n) => F.to(n)))) * 1.02;
  return (
    <div className="veh-center" data-testid="vehicle-charts">
      <ChartCard testId="chart-speed-time" title="Speed vs time (s)" stale={stale} legend={<span className="lg"><i style={{ background: C.torque }} />Speed</span>}>
        {(w, h) => <SpeedTime out={out} units={units} w={w} h={h} />}
      </ChartCard>
      <ChartCard testId="chart-sawtooth" title="Gear sawtooth" stale={stale} legend={<GearLegend n={nG} />}>
        {(w, h) => <Sawtooth out={out} units={units} w={w} h={h} nGears={nG} />}
      </ChartCard>
      <ChartCard
        testId="chart-tractive"
        title="Tractive effort vs road load"
        stale={stale}
        legend={
          <>
            <GearLegend n={nG} />
            <span className="lg"><i className="dash" style={{ color: C.critical }} />Road load</span>
            {gripOver && <span className="lg muted">grip limit {fmt(F.to(out.gripFullN))} {F.label} (above axis)</span>}
          </>
        }
      >
        {(w, h) => <Tractive out={out} units={units} w={w} h={h} />}
      </ChartCard>
    </div>
  );
}
