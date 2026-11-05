/** Right column of Vehicle mode: KPI tiles, gearing optimiser, accuracy notes. */
import { useEffect, useState } from 'react';
import { DEFAULT_FINAL_DRIVE_RANGE, DEFAULT_RATIO_SCALE_RANGE, type Objective } from '../../vehicle';
import { REFERENCE_CARS } from '../../vehicle/validation/referenceCars';
import { Select, Toggle } from '../controls';
import { useStore } from '../store';
import { fmt } from '../units';
import type { OptimizeOutput } from './compute';
import { useVehicleSim } from './sim';
import { speedConv } from './VehicleCharts';

/**
 * Round-2 validation with SIMULATED engine curves (research/vehicle_sources.md, "Round-2 results").
 * Bands use the worse of train (n=9) and fresh holdout (n=4) median |error|, to stay conservative.
 */
export const VALIDATION = {
  nTrain: 9,
  nHoldout: 4,
  zeroTo60Pct: 8.9,
  zeroTo60WorstPct: 17.5,
  quarterMilePct: 2.7,
  trapPct: 2.2,
  topSpeedPct: 2.9,
};

type Level = 'ok' | 'warn' | 'bad' | undefined;

function Tile({ label, value, unit, sub, alt, level, title, testId, pill, note }: { label: string; value: string; unit?: string; sub?: string; alt?: string; level?: Level; title?: string; testId?: string; pill?: string; note?: string }) {
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
      {note && (
        <span className="kpi-s" data-testid={testId ? `${testId}-grip` : undefined}>
          {note}
        </span>
      )}
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
  const gripS = a.tractionLimitedTo60S;
  const gripNote = a.tractionLimited && gripS >= 0.05 ? `grip-limited for ${gripS.toFixed(1)} s${a.tractionLimitedUntilMph != null ? ` (until ${fmt(S.label === 'mph' ? a.tractionLimitedUntilMph : a.tractionLimitedUntilMph * 1.609344)} ${S.label})` : ''}` : undefined;
  const t60 = (
    <Tile
      label="0-60 mph"
      value={sec(a.t0to60mph)}
      unit="s"
      sub={band(a.t0to60mph, VALIDATION.zeroTo60Pct)}
      note={gripNote}
      title={gripNote ? `Tyres are the limit for the first ${gripS.toFixed(2)} s of the run to 60 mph: more power will not help until grip stops limiting.` : 'Power-limited from the start: the tyres can transmit the engine torque.'}
      testId="kpi-0-60"
      level={undefined}
    />
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
        <Tile label="Top speed" pill="plausibility estimate" value={fmt(topShown)} unit={S.label} sub={topWhy} title="Steady-state force balance on a level road, compared only against manufacturer claims." />
        <div className="kpi-top-note">Checked only against manufacturer claims, with estimated Cd·A. The drag model is simple (constant Cd, no lift, no wind).</div>
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
const FD_RANGE = DEFAULT_FINAL_DRIVE_RANGE;
const RATIO_RANGE = DEFAULT_RATIO_SCALE_RANGE;
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
        <Toggle label="Search final drive" desc={`${FD_RANGE[0]}x to ${FD_RANGE[1]}x of current`} value={fd} onChange={setFd} />
        <Toggle label="Search each gear ratio" desc={`${RATIO_RANGE[0]}x to ${RATIO_RANGE[1]}x, keeps ratio steps >= 1.05`} value={gr} onChange={setGr} />
        <button className="btn primary veh-opt-btn" disabled={busy || (!fd && !gr)} onClick={() => run({ objective, finalDrive: fd, gearRatios: gr })} data-testid="optimize-btn">
          {busy ? 'Optimising…' : 'Optimize gearing'}
        </button>
        <div className="veh-warn" data-testid="optimizer-note" role="note">
          <b>Read with care.</b> The launch is a clutch (or converter) held at a fixed rpm, and bogging is not penalised, so 0-60
          gains from shorter gearing are optimistic. Treat results as a direction, not a recommendation, and check the edge warning below.
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
                {flags.gears ? ` (${flags.gears} gear ratio${flags.gears > 1 ? 's' : ''} pinned)` : ''}: the true optimum may lie beyond it, or be an artefact of the simplified launch model.
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
          <b>Quarter mile:</b> median error {VALIDATION.quarterMilePct} % (ET), {VALIDATION.trapPct} % (trap) (worse of {VALIDATION.nTrain} fitted and {VALIDATION.nHoldout} held-out cars), with engine curves from this simulator.
        </li>
        <li>
          <b>0-60 / 0-100 km/h:</b> median error {VALIDATION.zeroTo60Pct} %, worst car {VALIDATION.zeroTo60WorstPct} % off. Launch is the weak spot: the tyre slip model is simple, there is no per-car launch technique (launch control, clutch dump), and magazines scatter 5-10 % among themselves.
        </li>
        <li>
          <b>Top speed:</b> a plausibility estimate. Median error {VALIDATION.topSpeedPct} % against manufacturer claims for drag-limited cars, but every Cd·A is an estimate, so the agreement is partly luck.
        </li>
        <li>
          Level road, no wind, {`20 °C`} sea-level air unless changed. Global parameters were fitted on {VALIDATION.nTrain} cars; {VALIDATION.nHoldout} were held out and run once. AWD is not validated.
        </li>
      </ul>
      <div className="veh-acc-s">Method and sources: research/vehicle_sources.md. Most reference figures are recalled or from secondary sources, not yet checked against the original magazine test sheets.</div>
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
