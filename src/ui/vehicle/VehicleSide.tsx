/** Right column of Vehicle mode: KPI tiles, gearing optimiser, accuracy notes. */
import { useEffect, useState } from 'react';
import type { Objective } from '../../vehicle';
import { REFERENCE_CARS } from '../../vehicle/validation/referenceCars';
import { Select, Toggle } from '../controls';
import { useStore } from '../store';
import { fmt } from '../units';
import type { OptimizeOutput } from './compute';
import { useVehicleSim } from './sim';
import { speedConv } from './VehicleCharts';

/** Median |error| over the 9 reference cars with SIMULATED engine curves (research/vehicle_sources.md). */
export const VALIDATION = {
  n: 9,
  zeroTo60Pct: 6.9,
  zeroTo60WorstPct: 15.1,
  quarterMilePct: 2.1,
  trapPct: 2.7,
};

type Level = 'ok' | 'warn' | 'bad' | undefined;

function Tile({ label, value, unit, sub, alt, level, title, testId, pill }: { label: string; value: string; unit?: string; sub?: string; alt?: string; level?: Level; title?: string; testId?: string; pill?: string }) {
  return (
    <div className={`kpi ${level ?? ''}`} data-testid={testId} title={title}>
      <span className="kpi-lrow">
        <span className="kpi-l">{label}</span>
        {pill ? <span className="kpi-pill">{pill}</span> : alt && <span className="kpi-alt">{alt}</span>}
      </span>
      <span className="kpi-v">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      {sub && <span className="kpi-s">{sub}</span>}
    </div>
  );
}

const sec = (x: number | null | undefined, d = 2) => (x == null ? '—' : x.toFixed(d));
const band = (x: number | null | undefined, pct: number) => (x == null ? undefined : `typ. ±${pct.toFixed(0)} %: ${(x * (1 - pct / 100)).toFixed(2)} to ${(x * (1 + pct / 100)).toFixed(2)}`);

function Kpis() {
  const out = useVehicleSim((s) => s.out);
  const stale = useVehicleSim((s) => s.stale);
  const units = useStore((s) => s.units);
  const veh = useStore((s) => s.vehicle);
  if (!out) return <div className="kpis">Computing…</div>;
  const a = out.accel;
  const S = speedConv(units);
  const topShown = S.to(out.top.speedKph);
  const hpPerTonne = ((out.peakKw * 1000) / 745.7 / out.massKg) * 1000;
  const topWhy =
    out.top.limitedBy === 'redline'
      ? `gear-limited: redline in gear ${out.top.gear}, taller gearing would go faster`
      : out.top.limitedBy === 'limiter'
        ? 'electronic speed limiter'
        : `drag-limited in gear ${out.top.gear}`;
  const t60 = (
    <Tile label="0-60 mph" value={sec(a.t0to60mph)} unit="s" sub={band(a.t0to60mph, VALIDATION.zeroTo60Pct)} testId="kpi-0-60" level={undefined} />
  );
  const t100 = <Tile label="0-100 km/h" value={sec(a.t0to100kph)} unit="s" sub={band(a.t0to100kph, VALIDATION.zeroTo60Pct)} testId="kpi-0-100" />;
  return (
    <div className={`kpis ${stale ? 'stale' : ''}`} data-testid="vehicle-kpis">
      <div className="kpi-hero">
        {units === 'metric' ? t100 : t60}
        {units === 'metric' ? t60 : t100}
      </div>
      <div className="kpi-hero">
        <Tile label="1/4 mile ET" value={sec(a.quarterMileS)} unit="s" sub={band(a.quarterMileS, VALIDATION.quarterMilePct)} testId="kpi-et" />
        <Tile
          label="Trap speed"
          value={a.quarterMileTrapMph == null ? '—' : fmt(S.label === 'mph' ? a.quarterMileTrapMph : a.quarterMileTrapMph * 1.609344)}
          unit={S.label}
          sub={a.quarterMileTrapMph == null ? undefined : `typ. ±${VALIDATION.trapPct} %`}
          testId="kpi-trap"
        />
      </div>
      <div className="kpi-top" data-testid="kpi-top-speed">
        <Tile label="Top speed" pill="plausibility estimate" value={fmt(topShown)} unit={S.label} sub={topWhy} title="Steady-state force balance on a level road. Not validated against measured top speeds." />
        <div className="kpi-top-note">Not validated: no reference top speeds were checked, and the drag model is simple (constant Cd, no lift, no wind).</div>
      </div>
      <div className="kpi-grid">
        <Tile label="60-130 mph" value={sec(a.t60to130mph, 1)} unit="s" title="Rolling acceleration, no launch involved: usually the better-behaved number" />
        <Tile label="1/8 mile" value={sec(a.eighthMileS)} unit="s" sub={a.eighthMileTrapMph == null ? undefined : `${fmt(a.eighthMileTrapMph)} mph`} />
        <Tile label="Power/weight" value={fmt(hpPerTonne)} unit="hp/t" title="Engine peak power (crank) over total mass incl. driver" />
      </div>
      <div className="kpi-foot">
        {veh.rollout ? '1 ft rollout deducted (US magazine convention). ' : 'No rollout deducted. '}
        Engine peak {fmt(out.peakKw)} kW @ {fmt(out.peakKwRpm)} rpm drives the curve.
      </div>
    </div>
  );
}

// ---- optimiser ----------------------------------------------------------------
const OBJECTIVES: { value: Objective; label: string }[] = [
  { value: '0-60', label: 'Minimise 0-60 mph' },
  { value: '0-100kph', label: 'Minimise 0-100 km/h' },
  { value: 'quarter-mile', label: 'Minimise quarter-mile ET' },
  { value: '60-130', label: 'Minimise 60-130 mph' },
];
const FD_RANGE: [number, number] = [0.7, 1.4];
const RATIO_RANGE: [number, number] = [0.85, 1.15];
const near = (x: number, edge: number) => Math.abs(x - edge) < 0.006;

function edgeFlags(o: OptimizeOutput) {
  const k = o.finalDrive / o.finalDrive0;
  const fd = near(k, FD_RANGE[0]) ? 'low' : near(k, FD_RANGE[1]) ? 'high' : null;
  const gears = o.gearRatios.map((r, i) => r / o.gearRatios0[i]).filter((x) => near(x, RATIO_RANGE[0]) || near(x, RATIO_RANGE[1])).length;
  return { fd, gears, k };
}

function Optimizer() {
  const [objective, setObjective] = useState<Objective>('0-60');
  const [fd, setFd] = useState(true);
  const [gr, setGr] = useState(false);
  const run = useVehicleSim((s) => s.runOptimize);
  const busy = useVehicleSim((s) => s.optBusy);
  const opt = useVehicleSim((s) => s.opt);
  const optError = useVehicleSim((s) => s.optError);
  const clear = useVehicleSim((s) => s.clearOpt);
  const veh = useStore((s) => s.vehicle);
  const set = useStore((s) => s.setVehicle);
  useEffect(() => clear(), [veh, clear]);
  const flags = opt ? edgeFlags(opt) : null;
  const unit = opt?.objective === 'quarter-mile' ? 's ET' : 's';
  const improved = opt ? opt.baseline - opt.best : 0;
  return (
    <section className="veh-opt" data-testid="optimizer">
      <header className="veh-opt-h">
        <h3>Gearing optimiser</h3>
      </header>
      <div className="veh-opt-body">
        <Select label="Objective" value={objective} options={OBJECTIVES} onChange={setObjective} />
        <Toggle label="Search final drive" desc="0.7x to 1.4x of current" value={fd} onChange={setFd} />
        <Toggle label="Search each gear ratio" desc="0.85x to 1.15x, keeps ratio steps >= 1.05" value={gr} onChange={setGr} />
        <button className="btn primary veh-opt-btn" disabled={busy || (!fd && !gr)} onClick={() => run({ objective, finalDrive: fd, gearRatios: gr })} data-testid="optimize-btn">
          {busy ? 'Optimising…' : 'Optimize gearing'}
        </button>
        <div className="veh-warn" data-testid="optimizer-note" role="note">
          <b>Read with care.</b> The vehicle model has no wheelspin model yet: launch grip is a fixed fraction of peak friction, so
          the optimiser is free to pick very short gearing. Expect results that sit at the edge of the search range; treat them as
          a direction, not a recommendation.
        </div>
        {optError && <div className="veh-warn bad">Optimiser failed: {optError}</div>}
        {opt && flags && (
          <div className="veh-opt-res" data-testid="optimizer-result">
            <div className="veh-opt-row">
              <span>{opt.objective}</span>
              <b>
                {sec(opt.baseline)} → {sec(opt.best)} {unit}
              </b>
              <span className={`delta ${improved > 0.005 ? 'down' : 'flat'}`}>{improved > 0.005 ? `−${improved.toFixed(2)} s` : 'no gain'}</span>
            </div>
            <div className="veh-opt-row">
              <span>Final drive</span>
              <b>
                {opt.finalDrive0.toFixed(2)} → {opt.finalDrive.toFixed(2)}
              </b>
              <span className="mono">{((flags.k - 1) * 100).toFixed(0)} %</span>
            </div>
            {opt.gearRatios.some((r, i) => Math.abs(r - opt.gearRatios0[i]) > 1e-6) && (
              <div className="veh-opt-row wide">
                <span>Ratios</span>
                <b>{opt.gearRatios.map((r) => r.toFixed(2)).join(' · ')}</b>
              </div>
            )}
            {(flags.fd || flags.gears > 0) && (
              <div className="veh-warn bad" data-testid="edge-warning">
                At the edge of the search range
                {flags.fd ? ` (final drive ${flags.fd === 'low' ? 'minimum' : 'maximum'})` : ''}
                {flags.gears ? ` (${flags.gears} gear ratio${flags.gears > 1 ? 's' : ''} pinned)` : ''}: the true optimum may lie beyond it, or be an artefact of the missing wheelspin model.
              </div>
            )}
            <div className="veh-opt-btns">
              <button
                className="btn primary"
                data-testid="optimizer-apply"
                onClick={() => set({ spec: { transmission: { ...veh.spec.transmission, finalDrive: +opt.finalDrive.toFixed(3), gearRatios: opt.gearRatios.map((r) => +r.toFixed(3)) } } })}
              >
                Apply
              </button>
              <button className="btn ghost" onClick={clear}>
                Dismiss
              </button>
              <span className="veh-opt-ms mono">{opt.evaluations} runs · {opt.ms.toFixed(0)} ms</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ---- accuracy -------------------------------------------------------------------
function Reference() {
  const veh = useStore((s) => s.vehicle);
  const out = useVehicleSim((s) => s.out);
  const engineName = useStore((s) => s.result.config.name);
  const car = REFERENCE_CARS.find((c) => c.id === veh.presetId);
  if (!car || !out) return null;
  const m = car.measured;
  const row = (label: string, meas: number | null, model: number | null, unit: string, d = 2) =>
    meas == null || model == null ? null : (
      <tr key={label}>
        <td>{label}</td>
        <td>
          {meas.toFixed(d)} {unit}
        </td>
        <td>
          {model.toFixed(d)} {unit}
        </td>
        <td className={Math.abs((100 * (model - meas)) / meas) > 5 ? 'warn' : ''}>
          {(model >= meas ? '+' : '−') + Math.abs((100 * (model - meas)) / meas).toFixed(1)} %
        </td>
      </tr>
    );
  return (
    <div className="veh-ref" data-testid="reference-check">
      <div className="veh-ref-h">Measured vs this model: {car.spec.name}</div>
      <table>
        <thead>
          <tr>
            <th />
            <th>Measured</th>
            <th>Model</th>
            <th>Δ</th>
          </tr>
        </thead>
        <tbody>
          {row('0-60 mph', m.zeroTo60, out.accel.t0to60mph, 's')}
          {row('1/4 mile', m.quarterMileS, out.accel.quarterMileS, 's')}
          {row('Trap', m.quarterMileTrapMph, out.accel.quarterMileTrapMph, 'mph', 0)}
        </tbody>
      </table>
      <div className="veh-ref-s">
        {m.source}. Confidence: {car.refConfidence}. The model column uses the engine currently loaded ({engineName}).
      </div>
    </div>
  );
}

function Accuracy() {
  return (
    <section className="veh-acc" data-testid="accuracy-notes">
      <header className="veh-opt-h">
        <h3>How far to trust this</h3>
      </header>
      <ul>
        <li>
          <b>Quarter mile:</b> median error {VALIDATION.quarterMilePct} % (ET), {VALIDATION.trapPct} % (trap) against {VALIDATION.n} published car tests, with engine curves from this simulator.
        </li>
        <li>
          <b>0-60 / 0-100 km/h:</b> median error {VALIDATION.zeroTo60Pct} %, worst car {VALIDATION.zeroTo60WorstPct} % off. Launch is the weak spot: there is no wheelspin or clutch-drop model, and magazines scatter 5-10 % among themselves.
        </li>
        <li>
          <b>Top speed:</b> a plausibility estimate only. It has not been checked against measured top speeds.
        </li>
        <li>
          Level road, no wind, {`20 °C`} sea-level air unless changed. Global parameters were fitted on 6 of the 9 cars; 3 were held out.
        </li>
      </ul>
      <div className="veh-acc-s">Method and sources: research/vehicle_sources.md. Reference magazine figures are partly from secondary reposts.</div>
    </section>
  );
}

export function VehicleSide() {
  return (
    <aside className="panel side veh-side" data-testid="vehicle-side">
      <div className="veh-side-scroll">
        <Kpis />
        <Reference />
        <Optimizer />
        <Accuracy />
      </div>
    </aside>
  );
}
