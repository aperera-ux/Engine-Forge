import { useState } from 'react';
import type {
  BlockMaterial,
  CrankType,
  ExhaustType,
  FuelType,
  InductionType,
  Layout,
  PistonType,
  RodType,
  SuperchargerType,
  ValvetrainType,
} from '../sim/types';
import { SUPPORTED_CYLINDERS } from '../sim/layout';
import { DEFAULT_CONFIG } from '../sim/defaults';
import { useStore } from './store';
import { Derived, Section, Segmented, Select, Slider, Toggle } from './controls';
import { exhaustBiggerThanIntake, pistonSpeedLevel, valveFit, valveSplit } from './checks';
import { fmt, show } from './units';
import { Icon } from './icons';

type Tab = 'block' | 'heads' | 'induction' | 'exhaust' | 'fuel' | 'materials';
const TABS: { id: Tab; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { id: 'block', label: 'Block', icon: 'block' },
  { id: 'heads', label: 'Heads', icon: 'cam' },
  { id: 'induction', label: 'Intake', icon: 'turbo' },
  { id: 'exhaust', label: 'Exhaust', icon: 'exhaust' },
  { id: 'fuel', label: 'Tune', icon: 'fuel' },
  { id: 'materials', label: 'Build', icon: 'materials' },
];

export function ConfigPanel() {
  const [tab, setTab] = useState<Tab>('block');
  const collapsed = useStore((s) => s.panelCollapsed);
  const toggle = useStore((s) => s.togglePanel);
  const warnings = useStore((s) => s.result.warnings);
  const tabWarn = (t: Tab) => warnings.some((w) => w.severity !== 'info' && TAB_CODES[t].some((k) => w.code.includes(k)));

  if (collapsed) {
    return (
      <aside className="panel cfg collapsed">
        <button className="icon-btn" onClick={toggle} title="Expand configuration" aria-label="Expand configuration">
          <Icon name="chevronRight" />
        </button>
        <div className="rail-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className="icon-btn"
              title={t.label}
              onClick={() => {
                setTab(t.id);
                toggle();
              }}
            >
              <Icon name={t.icon} />
            </button>
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className="panel cfg" data-testid="config-panel">
      <div className="panel-h">
        <span className="panel-title">Configuration</span>
        <button className="icon-btn sm" onClick={toggle} title="Collapse panel" aria-label="Collapse panel">
          <Icon name="chevronLeft" />
        </button>
      </div>
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'on' : ''}
            onClick={() => setTab(t.id)}
            data-testid={`tab-${t.id}`}
          >
            <Icon name={t.icon} />
            <span>{t.label}</span>
            {tabWarn(t.id) && <i className="tab-dot" />}
          </button>
        ))}
      </nav>
      <div className="cfg-scroll" key={tab}>
        {tab === 'block' && <BlockTab />}
        {tab === 'heads' && <HeadsTab />}
        {tab === 'induction' && <InductionTab />}
        {tab === 'exhaust' && <ExhaustTab />}
        {tab === 'fuel' && <FuelTab />}
        {tab === 'materials' && <MaterialsTab />}
      </div>
    </aside>
  );
}

/** Which warning codes (substring match) belong to which tab, for the red dot. */
const TAB_CODES: Record<Tab, string[]> = {
  block: ['piston', 'rod', 'bore', 'stroke', 'compression', 'geometry'],
  heads: ['valve', 'cam', 'float', 'overlap'],
  induction: ['boost', 'turbo', 'super', 'throttle', 'intake', 'runner', 'choke', 'surge'],
  exhaust: ['exhaust', 'header', 'egt'],
  fuel: ['knock', 'lambda', 'fuel', 'detonation', 'rev', 'redline'],
  materials: ['block', 'crank', 'reliab', 'cylinder-pressure', 'pressure'],
};

function BlockTab() {
  const c = useStore((s) => s.config);
  const r = useStore((s) => s.result);
  const units = useStore((s) => s.units);
  const set = useStore((s) => s.setConfig);
  const allowed = SUPPORTED_CYLINDERS[c.layout];
  const [ps, psu] = show(r.meanPistonSpeedRedlineMs, 'speed', units, 1);
  const rodRatio = c.rodLengthMm / c.strokeMm;
  return (
    <>
      <Section title="Layout">
        <Segmented<Layout>
          value={c.layout}
          onChange={(layout) => set({ layout })}
          options={[
            { value: 'inline', label: 'Inline' },
            { value: 'v', label: 'Vee' },
            { value: 'flat', label: 'Flat / Boxer' },
          ]}
          testId="layout-seg"
        />
        <div className="ctl">
          <div className="ctl-label">Cylinders</div>
          <div className="chips" data-testid="cyl-chips">
            {allowed.map((n) => (
              <button key={n} className={`chip ${n === c.cylinders ? 'on' : ''}`} onClick={() => set({ cylinders: n })}>
                {n}
              </button>
            ))}
          </div>
        </div>
        {c.layout === 'v' && (
          <Slider label="V-angle" value={c.vAngleDeg} min={15} max={135} step={1} unit="°" onChange={(vAngleDeg) => set({ vAngleDeg })}
            hint={vAngleHint(c.cylinders, c.vAngleDeg)} />
        )}
        {c.layout === 'v' && c.cylinders === 8 && (
          <Segmented
            label="Crank plane"
            value={c.crankPlane}
            onChange={(crankPlane) => set({ crankPlane })}
            options={[
              { value: 'cross', label: 'Crossplane', title: '90° pins — burble, uneven per-bank pulses' },
              { value: 'flat', label: 'Flat-plane', title: '180° pins — high-rev scream, 2nd-order shake' },
            ]}
          />
        )}
      </Section>
      <Section title="Bottom end">
        <Slider label="Bore" q="length" value={c.boreMm} min={50} max={130} step={0.1} onChange={(boreMm) => set({ boreMm })} testId="slider-bore" />
        <Slider label="Stroke" q="length" value={c.strokeMm} min={40} max={130} step={0.1} onChange={(strokeMm) => set({ strokeMm })} testId="slider-stroke" />
        <Slider
          label="Rod length"
          q="length"
          value={c.rodLengthMm}
          min={Math.round(c.strokeMm * 1.3)}
          max={Math.max(Math.round(c.strokeMm * 2.4), Math.round(c.strokeMm * 1.3) + 10)}
          step={0.5}
          onChange={(rodLengthMm) => set({ rodLengthMm })}
          hint={rodRatio < 1.5 ? 'Short rod: high side-loading and piston acceleration' : undefined}
          hintLevel={rodRatio < 1.5 ? 'warn' : undefined}
        />
        <Slider label="Compression ratio" value={c.compressionRatio} min={6} max={16} step={0.1} unit=":1" onChange={(compressionRatio) => set({ compressionRatio })}
          hint={c.induction !== 'na' && c.compressionRatio > 11 ? 'High CR with boost — knock limited, watch spark retard' : undefined}
          hintLevel={c.induction !== 'na' && c.compressionRatio > 11 ? 'warn' : undefined} />
      </Section>
      <Derived
        items={[
          { label: 'Displacement', value: fmt(r.displacementL, 2), unit: 'L' },
          { label: 'Per cylinder', value: fmt(r.cylinderCc, 0), unit: 'cc' },
          { label: 'Bore / stroke', value: fmt(c.boreMm / c.strokeMm, 2), unit: c.boreMm > c.strokeMm * 1.02 ? 'over' : c.boreMm < c.strokeMm * 0.98 ? 'under' : 'square' },
          { label: 'Rod / stroke', value: fmt(rodRatio, 2), level: rodRatio < 1.5 ? 'warn' : 'ok' },
          { label: 'Piston speed @ redline', value: ps, unit: psu, level: pistonSpeedLevel(r.meanPistonSpeedRedlineMs) },
          { label: 'Firing order', value: r.firingOrder },
        ]}
      />
    </>
  );
}

function vAngleHint(n: number, v: number): string | undefined {
  const ideal = 720 / n;
  if (n <= 2) return undefined;
  if (Math.abs(v - ideal) < 1 || Math.abs(v - ideal / 2) < 1) return `${ideal}° is the natural even-fire angle for a V${n}`;
  return `Natural angle for V${n}: ${ideal}°`;
}

function HeadsTab() {
  const c = useStore((s) => s.config);
  const r = useStore((s) => s.result);
  const set = useStore((s) => s.setConfig);
  const setCam = useStore((s) => s.setCam);
  const units = useStore((s) => s.units);
  const fit = valveFit(c);
  const split = valveSplit(c.valvesPerCylinder);
  const exBig = exhaustBiggerThanIntake(c);
  const overlap = (c.cam.intakeDurationDeg + c.cam.exhaustDurationDeg) / 2 - 2 * c.cam.lobeSeparationDeg;
  const valveCounts = c.valvetrain === 'pushrod' ? [2, 3] : [2, 3, 4, 5];
  return (
    <>
      <Section title="Valvetrain">
        <Segmented<ValvetrainType>
          value={c.valvetrain}
          onChange={(valvetrain) => set({ valvetrain })}
          options={[
            { value: 'pushrod', label: 'OHV Pushrod' },
            { value: 'sohc', label: 'SOHC' },
            { value: 'dohc', label: 'DOHC' },
          ]}
        />
        <div className="ctl">
          <div className="ctl-label">Valves per cylinder</div>
          <div className="chips">
            {valveCounts.map((n) => (
              <button key={n} className={`chip ${n === c.valvesPerCylinder ? 'on' : ''}`} onClick={() => set({ valvesPerCylinder: n })}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <Slider label={`Intake valve ×${split.intake}`} q="length" value={c.intakeValveMm} min={20} max={65} step={0.1}
          onChange={(intakeValveMm) => set({ intakeValveMm })} hintLevel={fit.level === 'ok' ? undefined : fit.level} testId="slider-intake-valve" />
        <Slider label={`Exhaust valve ×${split.exhaust}`} q="length" value={c.exhaustValveMm} min={18} max={55} step={0.1}
          onChange={(exhaustValveMm) => set({ exhaustValveMm })} hintLevel={fit.level === 'ok' ? (exBig ? 'warn' : undefined) : fit.level}
          hint={fit.level !== 'ok' ? fit.message : exBig ? 'Exhaust larger than intake is unusual' : undefined} />
        <FitBar ratio={fit.ratio} />
      </Section>
      <Section title="Camshaft">
        <Slider label="Intake duration @ .050″" value={c.cam.intakeDurationDeg} min={180} max={320} step={1} unit="°" onChange={(intakeDurationDeg) => setCam({ intakeDurationDeg })} />
        <Slider label="Exhaust duration @ .050″" value={c.cam.exhaustDurationDeg} min={180} max={320} step={1} unit="°" onChange={(exhaustDurationDeg) => setCam({ exhaustDurationDeg })} />
        <Slider label="Intake lift" q="lift" value={c.cam.intakeLiftMm} min={6} max={20} step={0.1} onChange={(intakeLiftMm) => setCam({ intakeLiftMm })}
          hint={c.cam.intakeLiftMm > c.intakeValveMm * 0.35 ? 'Lift beyond ~0.3·D adds little flow' : undefined} hintLevel={c.cam.intakeLiftMm > c.intakeValveMm * 0.35 ? 'warn' : undefined} />
        <Slider label="Exhaust lift" q="lift" value={c.cam.exhaustLiftMm} min={6} max={20} step={0.1} onChange={(exhaustLiftMm) => setCam({ exhaustLiftMm })} />
        <Slider label="Lobe separation" value={c.cam.lobeSeparationDeg} min={100} max={122} step={0.5} unit="°" onChange={(lobeSeparationDeg) => setCam({ lobeSeparationDeg })} />
        <Slider label="Intake centerline" value={c.cam.intakeCenterlineDeg} min={95} max={125} step={0.5} unit="° ATDC" onChange={(intakeCenterlineDeg) => setCam({ intakeCenterlineDeg })} />
        <CamDiagram c={c.cam} />
        <Toggle label="Variable valve timing" desc="Cam phasing broadens the torque curve" value={c.cam.vvt} onChange={(vvt) => setCam({ vvt })} />
        <Toggle label="Variable lift" desc="VTEC / Valvetronic two-stage profile" value={c.cam.variableLift} onChange={(variableLift) => setCam({ variableLift })} />
      </Section>
      <Derived
        items={[
          { label: 'Overlap @ .050″', value: fmt(overlap, 0), unit: '°', level: overlap > 40 ? 'warn' : 'ok' },
          { label: 'Valve float', value: fmt(r.valveFloatRpm, 0), unit: 'rpm', level: r.valveFloatRpm < c.redlineRpm ? 'bad' : r.valveFloatRpm < c.redlineRpm * 1.05 ? 'warn' : 'ok' },
          { label: 'Intake curtain', value: show(split.intake * Math.PI * c.intakeValveMm * c.cam.intakeLiftMm / 100, 'none', units, 1)[0], unit: 'cm²' },
        ]}
      />
    </>
  );
}

function FitBar({ ratio }: { ratio: number }) {
  const pct = Math.min(1.2, ratio) / 1.2;
  return (
    <div className={`fitbar ${ratio > 1 ? 'bad' : ratio > 0.94 ? 'warn' : ''}`} title="Valve packaging vs bore">
      <div className="fitbar-track">
        <div className="fitbar-fill" style={{ width: `${pct * 100}%` }} />
        <div className="fitbar-limit" style={{ left: `${(1 / 1.2) * 100}%` }} />
      </div>
      <span>Valve packaging {Math.round(ratio * 100)}%</span>
    </div>
  );
}

/** Tiny valve-event diagram: intake/exhaust lift curves vs crank angle. */
function CamDiagram({ c }: { c: ReturnType<typeof useStore.getState>['config']['cam'] }) {
  const W = 260;
  const H = 54;
  // crank deg from -360 (exhaust TDC... ) map 0..720 -> width; TDC overlap at 360.
  const x = (deg: number) => (deg / 720) * W;
  const exCL = 360 - (2 * c.lobeSeparationDeg - c.intakeCenterlineDeg);
  const inCL = 360 + c.intakeCenterlineDeg;
  const lobe = (cl: number, dur: number, lift: number) => {
    const half = dur / 2 + 25; // seat-to-seat ≈ duration@.050 + ~50°
    const pts: string[] = [];
    for (let i = 0; i <= 40; i++) {
      const d = cl - half + (i / 40) * 2 * half;
      const y = Math.sin((i / 40) * Math.PI) ** 1.6 * lift;
      pts.push(`${x(d).toFixed(1)},${(H - 6 - (y / 20) * (H - 12)).toFixed(1)}`);
    }
    return pts.join(' ');
  };
  return (
    <svg className="camdiag" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Valve events">
      <line x1={x(360)} x2={x(360)} y1={2} y2={H - 4} className="tdc" />
      <line x1={0} x2={W} y1={H - 6} y2={H - 6} className="base" />
      <polyline points={lobe(exCL, c.exhaustDurationDeg, c.exhaustLiftMm)} className="ex" />
      <polyline points={lobe(inCL, c.intakeDurationDeg, c.intakeLiftMm)} className="in" />
      <text x={x(360) + 3} y={10}>TDC</text>
      <text x={4} y={10} className="ex-t">EX</text>
      <text x={W - 18} y={10} className="in-t">IN</text>
    </svg>
  );
}

function InductionTab() {
  const c = useStore((s) => s.config);
  const set = useStore((s) => s.setConfig);
  const setTurbo = useStore((s) => s.setTurbo);
  const setSc = useStore((s) => s.setSupercharger);
  const r = useStore((s) => s.result);
  const units = useStore((s) => s.units);
  const maxBoost = Math.max(...r.curve.map((p) => p.boostBar));
  const [bv, bu] = show(maxBoost, 'pressure', units, 2);
  // Rule of thumb for the dominant ram-tuning harmonic: rpm ≈ 2.1e6 / runner length (mm).
  const runnerTuneRpm = 2.1e6 / c.intakeRunnerMm;
  return (
    <>
      <Section title="Aspiration">
        <Segmented<InductionType>
          value={c.induction}
          onChange={(induction) => {
            const patch: Partial<typeof c> = { induction };
            // Presets store unused boosters zeroed; seed sane defaults when enabling one.
            if (induction === 'turbo' && c.turbo.targetBoostBar < 0.2) patch.turbo = { ...DEFAULT_CONFIG.turbo };
            if (induction === 'supercharger' && c.supercharger.targetBoostBar < 0.1) patch.supercharger = { ...DEFAULT_CONFIG.supercharger };
            set(patch);
          }}
          options={[
            { value: 'na', label: 'Natural' },
            { value: 'turbo', label: 'Turbo' },
            { value: 'supercharger', label: 'Supercharged' },
          ]}
          testId="induction-seg"
        />
        {c.induction === 'turbo' && (
          <div className="subgroup">
            <Slider label="Target boost" q="pressure" value={c.turbo.targetBoostBar} min={0.2} max={3} step={0.05} onChange={(targetBoostBar) => setTurbo({ targetBoostBar })} />
            <Slider label="Compressor inducer" q="length" value={c.turbo.compressorInducerMm} min={30} max={90} step={0.5} onChange={(compressorInducerMm) => setTurbo({ compressorInducerMm })} />
            <Slider label="Turbine A/R" value={c.turbo.turbineAR} min={0.4} max={1.4} step={0.01} onChange={(turbineAR) => setTurbo({ turbineAR })} hint="Smaller = earlier spool, more backpressure" />
            <Slider label="Intercooler effectiveness" value={Math.round(c.turbo.intercoolerEffectiveness * 100)} min={0} max={95} step={1} unit="%" onChange={(v) => setTurbo({ intercoolerEffectiveness: v / 100 })} />
            <Segmented label="Turbos" value={c.turbo.count} onChange={(count) => setTurbo({ count })} size="sm"
              options={[{ value: 1, label: 'Single' }, { value: 2, label: 'Twin' }]} />
            <Toggle label="Twin-scroll housing" desc="Divided turbine — sharper response" value={c.turbo.twinScroll} onChange={(twinScroll) => setTurbo({ twinScroll })} />
          </div>
        )}
        {c.induction === 'supercharger' && (
          <div className="subgroup">
            <Segmented<SuperchargerType>
              label="Blower type"
              value={c.supercharger.type}
              onChange={(type) => setSc({ type })}
              size="sm"
              options={[
                { value: 'roots', label: 'Roots' },
                { value: 'twin-screw', label: 'Twin-screw' },
                { value: 'centrifugal', label: 'Centrifugal' },
              ]}
            />
            <Slider label="Boost at redline" q="pressure" value={c.supercharger.targetBoostBar} min={0.1} max={2} step={0.05} onChange={(targetBoostBar) => setSc({ targetBoostBar })} />
            <Slider label="Intercooler effectiveness" value={Math.round(c.supercharger.intercoolerEffectiveness * 100)} min={0} max={95} step={1} unit="%" onChange={(v) => setSc({ intercoolerEffectiveness: v / 100 })} />
          </div>
        )}
      </Section>
      <Section title="Manifold & throttle">
        <Slider label="Runner length" q="length" value={c.intakeRunnerMm} min={80} max={800} step={5} onChange={(intakeRunnerMm) => set({ intakeRunnerMm })}
          hint={`Ram-tuning peak ≈ ${fmt(Math.round(runnerTuneRpm / 100) * 100)} rpm (rule of thumb)`} />
        <Slider label={c.itb ? 'Throttle (equiv. single)' : 'Throttle bore'} q="length" value={c.throttleMm} min={30} max={140} step={1} onChange={(throttleMm) => set({ throttleMm })} />
        <Toggle label="Individual throttle bodies" desc="One throttle per runner — crisp, loud" value={c.itb} onChange={(itb) => set({ itb })} />
      </Section>
      {c.induction !== 'na' && <Derived items={[{ label: 'Peak boost (sim)', value: bv, unit: bu }]} />}
    </>
  );
}

function ExhaustTab() {
  const c = useStore((s) => s.config);
  const set = useStore((s) => s.setConfig);
  const r = useStore((s) => s.result);
  const units = useStore((s) => s.units);
  const maxEgt = Math.max(...r.curve.map((p) => p.egtC));
  const [ev, eu] = show(maxEgt, 'temp', units, 0);
  return (
    <>
      <Section title="Manifold">
        <Segmented<ExhaustType>
          value={c.exhaust}
          onChange={(exhaust) => set({ exhaust })}
          options={[
            { value: 'log', label: 'Log' },
            { value: 'shorty', label: 'Shorty' },
            { value: 'long-tube', label: 'Long-tube' },
            { value: 'tuned-equal', label: 'Equal-len' },
          ]}
        />
        <Slider label="Primary length" q="length" value={c.headerPrimaryMm} min={150} max={1400} step={10} onChange={(headerPrimaryMm) => set({ headerPrimaryMm })} />
        <Slider label="Primary diameter" q="length" value={c.headerDiameterMm} min={25} max={70} step={0.5} onChange={(headerDiameterMm) => set({ headerDiameterMm })}
          hint={c.headerDiameterMm < c.exhaustValveMm * 1.05 ? 'Primary smaller than the valve — restrictive' : undefined}
          hintLevel={c.headerDiameterMm < c.exhaustValveMm * 1.05 ? 'warn' : undefined} />
      </Section>
      <Derived items={[{ label: 'Peak EGT (sim)', value: ev, unit: eu, level: maxEgt > 950 ? 'warn' : 'ok' }]} />
    </>
  );
}

const FUELS: { value: FuelType; label: string }[] = [
  { value: 'gas87', label: '87 AKI (91 RON)' },
  { value: 'gas91', label: '91 AKI (95 RON)' },
  { value: 'gas93', label: '93 AKI (98 RON)' },
  { value: 'race100', label: '100+ race gas' },
  { value: 'e85', label: 'E85 ethanol' },
  { value: 'methanol', label: 'Methanol' },
];

function FuelTab() {
  const c = useStore((s) => s.config);
  const set = useStore((s) => s.setConfig);
  const r = useStore((s) => s.result);
  const maxRetard = Math.max(...r.curve.map((p) => p.knockRetardDeg));
  const lambdaHint = c.lambda > 0.95 ? 'Lean at WOT — hot EGT, knock risk' : c.lambda < 0.76 ? 'Very rich — wasted fuel, cooler charge' : undefined;
  return (
    <>
      <Section title="Fuel">
        <Select label="Fuel" value={c.fuel} options={FUELS} onChange={(fuel) => set({ fuel })} />
        <Slider label="WOT lambda" value={c.lambda} min={0.7} max={1.05} step={0.01} unit="λ" onChange={(lambda) => set({ lambda })}
          hint={lambdaHint ?? `AFR ≈ ${fmt(c.lambda * stoich(c.fuel), 1)}:1`} hintLevel={lambdaHint ? 'warn' : undefined} />
        <Toggle label="Direct injection" desc="Charge cooling allows more advance" value={c.directInjection} onChange={(directInjection) => set({ directInjection })} />
      </Section>
      <Section title="Limits">
        <Slider label="Redline / limiter" value={c.redlineRpm} min={3000} max={20000} step={100} unit="rpm" onChange={(redlineRpm) => set({ redlineRpm })}
          hint={r.mechanicalLimitRpm < c.redlineRpm ? `Above mechanical limit (${fmt(r.mechanicalLimitRpm)} rpm)` : undefined}
          hintLevel={r.mechanicalLimitRpm < c.redlineRpm ? 'bad' : undefined} testId="slider-redline" />
        <Slider label="Idle" value={c.idleRpm} min={400} max={2000} step={25} unit="rpm" onChange={(idleRpm) => set({ idleRpm })} />
      </Section>
      <Derived
        items={[
          { label: 'Max knock retard', value: fmt(maxRetard, 1), unit: '°', level: maxRetard > 4 ? 'warn' : 'ok' },
          { label: 'Mechanical limit', value: fmt(r.mechanicalLimitRpm), unit: 'rpm', level: r.mechanicalLimitRpm < c.redlineRpm ? 'bad' : 'ok' },
        ]}
      />
    </>
  );
}

function stoich(f: FuelType): number {
  return f === 'e85' ? 9.8 : f === 'methanol' ? 6.45 : 14.7;
}

function MaterialsTab() {
  const c = useStore((s) => s.config);
  const set = useStore((s) => s.setConfig);
  const r = useStore((s) => s.result);
  const units = useStore((s) => s.units);
  const [m, mu] = show(r.massKg, 'mass', units);
  return (
    <>
      <Section title="Block">
        <Segmented<BlockMaterial> value={c.blockMaterial} onChange={(blockMaterial) => set({ blockMaterial })}
          options={[{ value: 'iron', label: 'Cast iron' }, { value: 'aluminum', label: 'Aluminium' }]} />
      </Section>
      <Section title="Rotating assembly">
        <Segmented<PistonType> label="Pistons" value={c.pistons} onChange={(pistons) => set({ pistons })} size="sm"
          options={[{ value: 'cast', label: 'Cast' }, { value: 'hypereutectic', label: 'Hypereutectic' }, { value: 'forged', label: 'Forged' }]} />
        <Segmented<RodType> label="Connecting rods" value={c.rods} onChange={(rods) => set({ rods })} size="sm"
          options={[{ value: 'cast', label: 'Cast' }, { value: 'forged-steel', label: 'Forged' }, { value: 'billet-steel', label: 'Billet' }, { value: 'titanium', label: 'Titanium' }]} />
        <Segmented<CrankType> label="Crankshaft" value={c.crank} onChange={(crank) => set({ crank })} size="sm"
          options={[{ value: 'cast', label: 'Cast' }, { value: 'forged', label: 'Forged' }, { value: 'billet', label: 'Billet' }]} />
      </Section>
      <Derived
        items={[
          { label: 'Engine mass', value: m, unit: mu },
          { label: 'Mechanical limit', value: fmt(r.mechanicalLimitRpm), unit: 'rpm' },
          { label: 'Reliability', value: fmt(r.reliabilityScore), unit: '/100', level: r.reliabilityScore < 50 ? 'bad' : r.reliabilityScore < 75 ? 'warn' : 'ok' },
        ]}
      />
    </>
  );
}
