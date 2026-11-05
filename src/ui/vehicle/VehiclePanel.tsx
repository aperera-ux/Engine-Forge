/** Car designer: every input of the vehicle model, plus presets from the validated reference cars. */
import { useEffect, useState } from 'react';
import { DYNO_ENGINE_BY_ID } from '../../sim/validation/dynoCurves';
import { REFERENCE_CARS } from '../../vehicle/validation/referenceCars';
import { Derived, Section, Segmented, Select, Slider, Toggle } from '../controls';
import { useStore } from '../store';
import { fmt, show } from '../units';
import { designFromReferenceCar, parseTire, TIRE_CLASSES, TRANSMISSIONS, type VehicleDesign } from './design';
import type { DriveLayout, TransmissionType } from '../../vehicle';

/** Compact numeric input that commits on blur/Enter and snaps into [min, max]. */
function NumField({ value, onChange, min, max, step = 0.01, decimals = 2, label, testId, width }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; decimals?: number; label: string; testId?: string; width?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (txt: string) => {
    setDraft(null);
    const n = parseFloat(txt);
    if (Number.isFinite(n)) onChange(+Math.min(max, Math.max(min, n)).toFixed(4));
  };
  return (
    <input
      className="num-input veh-num"
      style={width ? { width } : undefined}
      aria-label={label}
      data-testid={testId}
      inputMode="decimal"
      value={draft ?? value.toFixed(decimals)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(null);
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          onChange(+Math.min(max, Math.max(min, value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1))).toFixed(4));
        }
      }}
    />
  );
}

function PresetSection() {
  const v = useStore((s) => s.vehicle);
  const loadVehicle = useStore((s) => s.loadVehicle);
  const loadConfig = useStore((s) => s.loadConfig);
  const [withEngine, setWithEngine] = useState(true);
  const car = REFERENCE_CARS.find((c) => c.id === v.presetId);
  return (
    <Section title="Car preset">
      <Select
        label="Reference car"
        value={v.presetId ?? 'custom'}
        options={[{ value: 'custom', label: 'Custom (edited)' }, ...REFERENCE_CARS.map((c) => ({ value: c.id, label: c.label }))]}
        onChange={(id) => {
          const c = REFERENCE_CARS.find((x) => x.id === id);
          if (!c) return;
          loadVehicle(designFromReferenceCar(c));
          const eng = DYNO_ENGINE_BY_ID[c.engineId];
          if (withEngine && eng) loadConfig(eng.config);
        }}
      />
      <Toggle label="Also load the car's engine" desc="Otherwise your current engine build drives the car" value={withEngine} onChange={setWithEngine} />
      {car && (
        <div className="veh-note" data-testid="preset-note">
          Spec from {car.measured.source}; confidence <b>{car.refConfidence}</b>. Estimated fields: {car.estimated.join(', ') || 'none'}.
        </div>
      )}
    </Section>
  );
}

export function VehiclePanel() {
  const v = useStore((s) => s.vehicle);
  const set = useStore((s) => s.setVehicle);
  const units = useStore((s) => s.units);
  const redline = useStore((s) => s.result.config.redlineRpm);
  const s = v.spec;
  const tr = s.transmission;
  const setSpec = (p: Partial<VehicleDesign['spec']>) => set({ spec: p });
  const setTr = (p: Partial<VehicleDesign['spec']['transmission']>) => set({ spec: { transmission: { ...tr, ...p } } });
  const [tireDraft, setTireDraft] = useState(v.tireCode);
  useEffect(() => setTireDraft(v.tireCode), [v.tireCode]);
  const tireOk = tireDraft.trim() === '' || !!parseTire(tireDraft);
  const cd = s.cdA / v.frontalAreaM2;
  const [rr, rrU] = show(s.tireRadiusM * 1000, 'length', units, 0);
  const ratios = tr.gearRatios;
  const setRatio = (i: number, x: number) => setTr({ gearRatios: ratios.map((r, k) => (k === i ? x : r)) });
  const nonMonotone = ratios.some((r, i) => i > 0 && r >= ratios[i - 1]);
  const topKph = ((redline / 60) * 2 * Math.PI * s.tireRadiusM * 3.6) / (ratios[ratios.length - 1] * tr.finalDrive);
  const topShown = units === 'metric' ? `${fmt(topKph)} km/h` : `${fmt(topKph / 1.609344)} mph`;

  return (
    <aside className="panel cfg veh-panel" data-testid="vehicle-panel">
      <div className="panel-h">
        <span className="panel-title">Car designer</span>
      </div>
      <div className="cfg-scroll">
        <PresetSection />
        <Section title="Mass & balance">
          <Slider label="Curb mass" value={s.curbMassKg} min={600} max={3500} step={5} q="mass" onChange={(x) => setSpec({ curbMassKg: x })} testId="veh-mass" hint={`+ driver ${show(s.driverKg ?? 80, 'mass', units)[0]} ${show(0, 'mass', units)[1]} added by the runner`} />
          <Slider label="Driver + gear" value={s.driverKg ?? 80} min={0} max={200} step={5} q="mass" onChange={(x) => setSpec({ driverKg: x })} />
          <Slider label="Front weight" value={Math.round(s.frontWeightFraction * 1000) / 10} min={30} max={70} step={0.5} unit="%" onChange={(x) => setSpec({ frontWeightFraction: x / 100 })} />
          <Slider label="CG height" value={Math.round(s.cgHeightM * 1000)} min={300} max={900} step={5} q="length" onChange={(x) => setSpec({ cgHeightM: x / 1000 })} />
          <Slider label="Wheelbase" value={Math.round(s.wheelbaseM * 1000)} min={2000} max={3600} step={5} q="length" onChange={(x) => setSpec({ wheelbaseM: x / 1000 })} />
        </Section>
        <Section title="Drivetrain">
          <Segmented<DriveLayout>
            label="Layout"
            value={s.layout}
            size="sm"
            testId="veh-layout"
            onChange={(layout) => setSpec({ layout, ...(layout === 'AWD' ? { awdFrontSplit: s.awdFrontSplit ?? 0.4 } : {}) })}
            options={[
              { value: 'FWD', label: 'FWD' },
              { value: 'RWD', label: 'RWD' },
              { value: 'AWD', label: 'AWD' },
            ]}
          />
          {s.layout === 'AWD' && <Slider label="Front torque split" value={Math.round((s.awdFrontSplit ?? 0.4) * 100)} min={0} max={100} step={1} unit="%" onChange={(x) => setSpec({ awdFrontSplit: x / 100 })} />}
          <Select label="Transmission" value={tr.type} options={TRANSMISSIONS} onChange={(type: TransmissionType) => setTr({ type })} />
          <div className="ctl">
            <div className="ctl-row">
              <span className="ctl-label">Gear ratios</span>
              <span className="veh-gear-btns">
                <button className="btn ghost sm" disabled={ratios.length <= 2} onClick={() => setTr({ gearRatios: ratios.slice(0, -1) })} aria-label="Remove top gear" data-testid="gear-remove">
                  −
                </button>
                <span className="mono">{ratios.length} spd</span>
                <button className="btn ghost sm" disabled={ratios.length >= 10} onClick={() => setTr({ gearRatios: [...ratios, Math.max(0.3, +(ratios[ratios.length - 1] * 0.82).toFixed(2))] })} aria-label="Add gear" data-testid="gear-add">
                  +
                </button>
              </span>
            </div>
            <div className="veh-gears" data-testid="gear-grid">
              {ratios.map((r, i) => (
                <label key={i} className="veh-gear">
                  <span>{i + 1}</span>
                  <NumField label={`Gear ${i + 1} ratio`} testId={`gear-${i + 1}`} value={r} min={0.3} max={6} step={0.01} onChange={(x) => setRatio(i, x)} />
                </label>
              ))}
            </div>
            {nonMonotone && <div className="hint hint-warn">Ratios should decrease with each gear.</div>}
          </div>
          <Slider label="Final drive" value={tr.finalDrive} min={1.5} max={6} step={0.01} unit=":1" onChange={(x) => setTr({ finalDrive: x })} testId="veh-fd" hint={`Redline in top gear = ${topShown} (gearing only; top speed is also drag-limited)`} />
          <Slider label="Shift time" value={tr.shiftTimeS ?? { manual: 0.3, dct: 0.08, automatic: 0.25 }[tr.type]} min={0.03} max={0.6} step={0.01} unit="s" onChange={(x) => setTr({ shiftTimeS: x })} hint={tr.shiftTimeS === undefined ? 'Type default; edit to override' : undefined} />
          <Slider label="Launch rpm" value={tr.launchRpm ?? Math.round(redline * 0.45 / 100) * 100} min={1000} max={Math.max(2000, Math.round(redline * 0.9))} step={100} unit="rpm" onChange={(x) => setTr({ launchRpm: x })} hint={tr.launchRpm === undefined ? 'Auto: from the torque curve (35-65 % of redline)' : 'Manual override'} />
          {tr.type === 'automatic' && <Slider label="Converter stall ratio" value={tr.converterStallRatio ?? 1} min={1} max={2.5} step={0.05} unit="x" onChange={(x) => setTr({ converterStallRatio: x })} hint="Torque multiplication at stall; fades out by speed ratio 0.85" />}
          <Segmented<'optimal' | 'redline'>
            label="Shift strategy"
            value={v.shiftStrategy}
            size="sm"
            onChange={(shiftStrategy) => set({ shiftStrategy })}
            options={[
              { value: 'optimal', label: 'Optimal (max force)' },
              { value: 'redline', label: 'At redline' },
            ]}
          />
          {v.shiftStrategy === 'redline' && <Slider label="Shift point" value={Math.round(v.shiftRpmFraction * 100)} min={70} max={100} step={1} unit="% of limiter" onChange={(x) => set({ shiftRpmFraction: x / 100 })} />}
        </Section>
        <Section title="Tires">
          <label className="ctl">
            <span className="ctl-label">Size (metric code)</span>
            <input
              className={`veh-text ${tireOk ? '' : 'bad'}`}
              data-testid="tire-code"
              placeholder="255/35R19"
              value={tireDraft}
              onChange={(e) => {
                setTireDraft(e.target.value);
                const p = parseTire(e.target.value);
                if (p) set({ tireCode: e.target.value.trim(), spec: { tireRadiusM: p.radiusM, tireWidthMm: p.widthMm } });
              }}
            />
            <span className="hint">{tireOk ? `Rolling radius ${rr} ${rrU} (0.97 x unloaded; +-1 % real-world)` : 'Not a valid code, expected e.g. 255/35R19'}</span>
          </label>
          <Slider label="Rolling radius" value={Math.round(s.tireRadiusM * 1000)} min={250} max={450} step={1} q="length" onChange={(x) => set({ tireCode: '', spec: { tireRadiusM: x / 1000 } })} />
          <Slider label="Tire width" value={s.tireWidthMm ?? 245} min={125} max={405} step={5} q="length" onChange={(x) => setSpec({ tireWidthMm: x })} />
          <Select label="Compound class" value={s.tireClass} options={TIRE_CLASSES} onChange={(tireClass) => setSpec({ tireClass })} />
        </Section>
        <Section title="Aero & resistance">
          <Slider label="Drag coefficient Cd" value={+cd.toFixed(3)} min={0.2} max={0.6} step={0.005} onChange={(x) => setSpec({ cdA: x * v.frontalAreaM2 })} testId="veh-cd" hint={`Cd*A = ${(s.cdA).toFixed(3)} m²`} />
          <Slider label="Frontal area" value={v.frontalAreaM2} min={1.4} max={3.2} step={0.05} q="area" onChange={(x) => set({ frontalAreaM2: x, spec: { cdA: cd * x } })} hint={v.presetId ? 'Presets assume 2.0 m² (only Cd*A is published)' : undefined} />
          <Slider label="Rolling resistance (low speed)" value={s.crr0 ?? 0.011} min={0.006} max={0.02} step={0.0005} onChange={(x) => setSpec({ crr0: x })} />
        </Section>
        <Section title="Conditions">
          <Slider label="Air temperature" value={v.ambient.tempC} min={-10} max={45} step={1} q="temp" onChange={(tempC) => set({ ambient: { ...v.ambient, tempC } })} />
          <Slider label="Air pressure" value={v.ambient.pressureKPa} min={70} max={105} step={0.5} unit="kPa" onChange={(pressureKPa) => set({ ambient: { ...v.ambient, pressureKPa } })} hint="101.3 kPa = sea level; ~89.9 at 1000 m" />
          <Toggle label="1 ft rollout" desc="US magazine convention (times are 0.2-0.3 s quicker)" value={v.rollout} onChange={(rollout) => set({ rollout })} />
        </Section>
        <Derived
          items={[
            { label: 'Total mass', value: show((s.curbMassKg + (s.driverKg ?? 80)), 'mass', units)[0], unit: show(0, 'mass', units)[1] },
            { label: 'Cd·A', value: s.cdA.toFixed(3), unit: 'm²' },
          ]}
        />
      </div>
    </aside>
  );
}
