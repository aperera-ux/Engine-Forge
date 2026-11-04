import { useMemo } from 'react';
import { useStore } from './store';
import { fmt, show } from './units';
import { Icon } from './icons';
import { pistonSpeedLevel, valveFit } from './checks';
import type { SimWarning } from '../sim/types';

type Level = 'ok' | 'warn' | 'bad' | undefined;

function Tile({ label, value, unit, sub, alt, level, title, testId }: { label: string; value: string; unit?: string; sub?: string; alt?: string; level?: Level; title?: string; testId?: string }) {
  return (
    <div className={`kpi ${level ?? ''}`} data-testid={testId} title={title}>
      <span className="kpi-lrow">
        <span className="kpi-l">{label}</span>
        {alt && <span className="kpi-alt">{alt}</span>}
      </span>
      <span className="kpi-v">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      {sub && <span className="kpi-s">{sub}</span>}
    </div>
  );
}

export function KpiPanel() {
  const r = useStore((s) => s.result);
  const c = useStore((s) => s.config);
  const units = useStore((s) => s.units);
  const [pk, pku] = show(r.peakPowerKw, 'power', units);
  const [tq, tqu] = show(r.peakTorqueNm, 'torque', units);
  const [mass, massu] = show(r.massKg, 'mass', units);
  const [ps, psu] = show(r.meanPistonSpeedRedlineMs, 'speed', units, 1);
  const altPower = units === 'metric' ? `${fmt(r.peakHp)} hp` : `${fmt(r.peakPowerKw)} kW`;
  const altTq = units === 'metric' ? `${fmt(r.peakTorqueLbFt)} lb·ft` : `${fmt(r.peakTorqueNm)} N·m`;
  const hpPerKg = units === 'metric' ? r.hpPerKg : r.hpPerKg / 2.20462;
  const psl = pistonSpeedLevel(r.meanPistonSpeedRedlineMs);
  const psLevel = psl === 'ok' ? undefined : psl;
  return (
    <div className="kpis" data-testid="kpis">
      <div className="kpi-hero">
        <Tile label="Power" value={pk} unit={pku} sub={`peak @ ${fmt(r.peakPowerRpm)} rpm`} alt={altPower} testId="kpi-power" />
        <Tile label="Torque" value={tq} unit={tqu} sub={`peak @ ${fmt(r.peakTorqueRpm)} rpm`} alt={altTq} testId="kpi-torque" />
      </div>
      <div className="kpi-grid">
        <Tile label="Disp." title={`Displacement ${fmt(r.displacementCc)} cc`} value={fmt(r.displacementL, 2)} unit="L" />
        <Tile label="Specific" title="Specific output" value={fmt(r.specificOutputHpL, 1)} unit="hp/L" />
        <Tile label="Bore×Stroke" title="Bore × stroke" value={`${show(c.boreMm, 'length', units, 0)[0]}×${show(c.strokeMm, 'length', units, 0)[0]}`} />
        <Tile label="Mass" value={mass} unit={massu} />
        <Tile label="Power/wt" title="Power-to-weight (engine only)" value={fmt(hpPerKg, 2)} unit={units === 'metric' ? 'hp/kg' : 'hp/lb'} />
        <Tile label="Pist. speed" title="Mean piston speed at redline" value={ps} unit={psu} level={psLevel} testId="kpi-piston-speed" />
        <Tile label="Pist. accel" title="Peak piston acceleration at redline" value={fmt(r.maxPistonAccelRedline / 9.81)} unit="g" level={r.maxPistonAccelRedline / 9.81 > 3500 ? 'warn' : undefined} />
        <Tile label="Valve float" title="Estimated valve-float rpm" value={fmt(r.valveFloatRpm)} unit="rpm" level={r.valveFloatRpm < c.redlineRpm ? 'bad' : r.valveFloatRpm < c.redlineRpm * 1.05 ? 'warn' : undefined} />
        <Tile label="Mech. limit" title="Safe rpm for the rotating assembly" value={fmt(r.mechanicalLimitRpm)} unit="rpm" level={r.mechanicalLimitRpm < c.redlineRpm ? 'bad' : undefined} />
      </div>
      <Reliability score={r.reliabilityScore} />
      <Balance />
    </div>
  );
}

function Reliability({ score }: { score: number }) {
  const s = Math.max(0, Math.min(100, score));
  const level = s < 50 ? 'bad' : s < 75 ? 'warn' : 'ok';
  const label = s >= 90 ? 'Stock margins' : s >= 75 ? 'Healthy' : s >= 50 ? 'Stressed' : s >= 25 ? 'Fragile' : 'Grenade';
  return (
    <div className={`meter ${level}`} data-testid="reliability">
      <div className="meter-h">
        <span className="kpi-l">Reliability</span>
        <span className="meter-v">
          {fmt(s)}
          <small>/100 · {label}</small>
        </span>
      </div>
      <div className="meter-track">
        {Array.from({ length: 20 }, (_, i) => (
          <span key={i} className={i < Math.round(s / 5) ? 'on' : ''} />
        ))}
      </div>
    </div>
  );
}

function Balance() {
  const b = useStore((s) => s.result.balance);
  const firingOrder = useStore((s) => s.result.firingOrder);
  const even = useStore((s) => s.result.evenFiring);
  const items: [string, 'balanced' | 'unbalanced'][] = [
    ['1st force', b.primaryForce],
    ['1st couple', b.primaryCouple],
    ['2nd force', b.secondaryForce],
    ['2nd couple', b.secondaryCouple],
  ];
  return (
    <div className="balance">
      <div className="balance-h">
        <span className="kpi-l">Firing &amp; balance</span>
        <span className={`fire-tag ${even ? 'even' : 'uneven'}`} data-testid="kpi-firing">
          {even ? 'Even fire' : 'Uneven fire'}
        </span>
      </div>
      <div className="firing-order" title="Firing order">
        {firingOrder.split('-').map((n, i) => (
          <span key={i}>{n}</span>
        ))}
      </div>
      <div className="balance-grid">
        {items.map(([k, v]) => (
          <span key={k} className={`bal ${v}`} title={`${k}: ${v}`}>
            <Icon name={v === 'balanced' ? 'check' : 'close'} size={11} />
            {k}
          </span>
        ))}
      </div>
      <p className="balance-sum" title={b.summary}>
        {b.summary}
      </p>
    </div>
  );
}

const SEV_ORDER: Record<SimWarning['severity'], number> = { critical: 0, warn: 1, info: 2 };

/** Sim warnings plus UI-side geometric checks, sorted by severity. */
export function useAllWarnings(): SimWarning[] {
  const simWarnings = useStore((s) => s.result.warnings);
  const config = useStore((s) => s.config);
  return useMemo(() => {
    const fit = valveFit(config);
    const all: SimWarning[] =
      fit.level !== 'ok' && !simWarnings.some((w) => /valve-(fit|size|pack|geometry)/.test(w.code))
        ? [...simWarnings, { severity: fit.level === 'bad' ? 'critical' : 'warn', code: 'valve-fit', message: fit.message }]
        : simWarnings;
    return [...all].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  }, [simWarnings, config]);
}

export function WarningItems({ items }: { items: SimWarning[] }) {
  return (
    <ul>
      {items.map((w, i) => (
        <li key={`${w.code}-${i}`} className={`warn-item ${w.severity}`}>
          <Icon name={w.severity === 'critical' ? 'critical' : w.severity === 'warn' ? 'warn' : 'info'} size={14} />
          <div>
            <span className="warn-msg">{w.message}</span>
            <span className="warn-code">
              {w.severity === 'critical' ? 'Critical' : w.severity === 'warn' ? 'Warning' : 'Info'} · {w.code}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function WarningsList() {
  const warnings = useAllWarnings();
  const sorted = warnings;
  const counts = { critical: 0, warn: 0, info: 0 };
  warnings.forEach((w) => counts[w.severity]++);
  return (
    <div className={`warnings ${sorted.length ? 'has-items' : ''}`} data-testid="warnings">
      <div className="panel-h sub">
        <span className="panel-title">Diagnostics</span>
        <span className="sev-counts">
          {counts.critical > 0 && <span className="sev critical">{counts.critical}</span>}
          {counts.warn > 0 && <span className="sev warn">{counts.warn}</span>}
          {counts.info > 0 && <span className="sev info">{counts.info}</span>}
        </span>
      </div>
      {sorted.length === 0 ? (
        <div className="warn-empty">
          <Icon name="check" size={14} /> All systems nominal
        </div>
      ) : (
        <WarningItems items={sorted} />
      )}
    </div>
  );
}
