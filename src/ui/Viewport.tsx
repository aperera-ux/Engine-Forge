import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useStore, curveAt, type ViewMode } from './store';
import { SceneHost } from './SceneHost';
import { Tachometer } from './Tachometer';
import { Segmented } from './controls';
import { Icon } from './icons';
import { cancelDynoPull, crankClock, runDynoPull } from './dyno';
import { computeLayout, strokeAt, type Stroke } from '../sim/layout';
import { show, fmt } from './units';
import { engineCode } from './format';
import { useAllWarnings, WarningItems } from './Analytics';
import { Onboarding } from './Onboarding';

export function Viewport() {
  const config = useStore((s) => s.config);
  const rpm = useStore((s) => s.rpm);
  const running = useStore((s) => s.running);
  const viewMode = useStore((s) => s.viewMode);
  const load = useStore((s) => s.load);
  const result = useStore((s) => s.result);
  const setHovered = useStore((s) => s.setHoveredCylinder);
  const egtC = curveAt(result, rpm, 'egtC');
  const wrapRef = useRef<HTMLDivElement>(null);
  const mouse = useRef({ x: 0, y: 0 });
  const onHover = useCallback((n: number | null) => setHovered(n), [setHovered]);
  const [quality, setQuality] = useState<'high' | 'low'>('high');
  const [fps, setFps] = useState<number | null>(null);
  const slow = useRef(0);
  const onFps = useCallback((f: number) => {
    setFps(Math.round(f));
    // Auto-degrade post-processing on slow GPUs (2 s of < 28 fps).
    slow.current = f < 28 ? slow.current + 1 : 0;
    if (slow.current >= 4) setQuality('low');
  }, []);

  return (
    <section
      className="viewport panel"
      ref={wrapRef}
      onPointerMove={(e) => {
        const r = wrapRef.current!.getBoundingClientRect();
        mouse.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      }}
      data-testid="viewport"
    >
      <div className="scene">
        <SceneHost config={config} rpm={rpm} running={running} viewMode={viewMode} load={load} egtC={egtC} onCylinderHover={onHover} quality={quality} onFps={onFps} />
      </div>
      <div className="vignette" />
      <HudTitle />
      <div className="hud hud-tr">
        <ViewToggle />
        {fps !== null && (
          <button
            className="fps"
            title={`Render quality: ${quality} (click to toggle)`}
            onClick={() => {
              slow.current = -1e9;
              setQuality(quality === 'high' ? 'low' : 'high');
            }}
          >
            {fps} fps · {quality === 'high' ? 'HQ' : 'LQ'}
          </button>
        )}
      </div>
      <HudGauges />
      <HudControls />
      <CylinderTooltip mouse={mouse} />
      <Onboarding />
    </section>
  );
}

function HudTitle() {
  const c = useStore((s) => s.config);
  const r = useStore((s) => s.result);
  const simError = useStore((s) => s.simError);
  const setConfig = useStore((s) => s.setConfig);
  return (
    <div className="hud hud-tl">
      <input
        className="hud-name"
        value={c.name}
        placeholder="Untitled engine"
        onChange={(e) => setConfig({ name: e.target.value })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label="Engine name"
        spellCheck={false}
        title="Click to rename"
      />
      <div className="hud-spec">
        <span>{fmt(r.displacementL, 1)} L</span>
        <span>{engineCode(c)}</span>
        <span>
          {c.valvetrain === 'pushrod' ? 'OHV' : c.valvetrain.toUpperCase()} {c.cylinders * c.valvesPerCylinder}V
        </span>
        <span>{c.induction === 'na' ? 'NA' : c.induction === 'turbo' ? (c.turbo.count === 2 ? 'Twin-turbo' : 'Turbo') : 'Supercharged'}</span>
      </div>
      <HudAlerts />
      {simError && <div className="hud-err">Sim error — showing last good result</div>}
    </div>
  );
}

function HudAlerts() {
  const warnings = useAllWarnings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const crit = warnings.filter((w) => w.severity === 'critical').length;
  const warn = warnings.filter((w) => w.severity === 'warn').length;
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  useEffect(() => {
    if (!crit && !warn) setOpen(false);
  }, [crit, warn]);
  if (!crit && !warn) return null;
  return (
    <div className="hud-alerts-wrap" ref={ref}>
      <button className={`hud-alerts ${crit ? 'critical' : 'warn'} ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} title="Show diagnostics" data-testid="hud-alerts">
        <Icon name={crit ? 'critical' : 'warn'} size={13} />
        {crit > 0 && <span>{crit} critical</span>}
        {warn > 0 && <span>{warn} warning{warn > 1 ? 's' : ''}</span>}
        <svg viewBox="0 0 10 6" width="8" height="5" aria-hidden>
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      {open && (
        <div className="alerts-pop warnings" data-testid="alerts-pop">
          <WarningItems items={warnings} />
        </div>
      )}
    </div>
  );
}

function ViewToggle() {
  const viewMode = useStore((s) => s.viewMode);
  const set = useStore((s) => s.setViewMode);
  return (
    <Segmented<ViewMode>
      size="sm"
      value={viewMode}
      onChange={set}
      options={[
        { value: 'solid', label: 'Solid' },
        { value: 'cutaway', label: 'Cutaway' },
        { value: 'xray', label: 'X-ray' },
      ]}
      testId="viewmode"
    />
  );
}

function HudGauges() {
  const rpm = useStore((s) => s.rpm);
  const result = useStore((s) => s.result);
  const units = useStore((s) => s.units);
  const redline = useStore((s) => s.config.redlineRpm);
  const dyno = useStore((s) => s.dynoActive);
  const load = useStore((s) => s.load);
  const induction = useStore((s) => s.config.induction);
  const max = Math.ceil((redline * 1.12) / 1000) * 1000;
  const [p, pu] = show(curveAt(result, rpm, 'powerKw'), 'power', units);
  const [t, tu] = show(curveAt(result, rpm, 'torqueNm'), 'torque', units);
  const [b, bu] = show(curveAt(result, rpm, 'boostBar'), 'pressure', units, 2);
  return (
    <div className="hud hud-bl">
      <Tachometer rpm={rpm} redline={redline} max={max} dyno={dyno} size={136} />
      <div className="hud-readouts">
        <Readout label="Power" value={p} unit={pu} accent testId="hud-power" />
        <Readout label="Torque" value={t} unit={tu} testId="hud-torque" />
        {induction !== 'na' ? <Readout label="Boost" value={b} unit={bu} /> : <Readout label="Load" value={fmt(load * 100)} unit="%" />}
      </div>
    </div>
  );
}

function Readout({ label, value, unit, accent, testId }: { label: string; value: string; unit: string; accent?: boolean; testId?: string }) {
  return (
    <div className={`readout ${accent ? 'accent' : ''}`} data-testid={testId}>
      <span className="readout-l">{label}</span>
      <span className="readout-v">
        {value}
        <small>{unit}</small>
      </span>
    </div>
  );
}

function HudControls() {
  const rpm = useStore((s) => s.rpm);
  const running = useStore((s) => s.running);
  const { idleRpm, redlineRpm } = useStore((s) => s.config);
  const setRpm = useStore((s) => s.setRpm);
  const setRunning = useStore((s) => s.setRunning);
  const dyno = useStore((s) => s.dynoActive);
  const pct = ((rpm - idleRpm) / (redlineRpm - idleRpm || 1)) * 100;
  return (
    <div className="hud hud-bottom">
      <button
        className="icon-btn round"
        onClick={() => setRunning(!running)}
        title={running ? 'Pause (Space)' : 'Run (Space)'}
        aria-label={running ? 'Pause' : 'Run'}
        data-testid="run-toggle"
      >
        <Icon name={running ? 'pause' : 'play'} />
      </button>
      <div className="rpm-ctl">
        <div className="rpm-ctl-row">
          <span>Engine speed</span>
          <span className="mono">{fmt(rpm)} rpm</span>
        </div>
        <input
          type="range"
          className="range"
          min={idleRpm}
          max={redlineRpm}
          step={10}
          value={rpm}
          disabled={dyno}
          style={{ ['--pct' as string]: `${pct}%` }}
          onChange={(e) => setRpm(parseFloat(e.target.value))}
          aria-label="Engine rpm"
          data-testid="rpm-slider"
        />
      </div>
      <button className={`btn primary dyno-btn ${dyno ? 'active' : ''}`} onClick={() => (dyno ? cancelDynoPull() : runDynoPull())} data-testid="dyno-pull">
        <Icon name="dyno" />
        {dyno ? 'Abort pull' : 'Dyno pull'}
      </button>
    </div>
  );
}

const STROKE_LABEL: Record<Stroke, string> = { intake: 'Intake', compression: 'Compression', power: 'Power', exhaust: 'Exhaust' };

function CylinderTooltip({ mouse }: { mouse: RefObject<{ x: number; y: number }> }) {
  const hovered = useStore((s) => s.hoveredCylinder);
  const config = useStore((s) => s.config);
  const lay = useMemo(() => computeLayout(config), [config]);
  const [, force] = useState(0);
  useEffect(() => {
    if (hovered == null) return;
    let raf = 0;
    const tick = () => {
      force((n) => n + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hovered]);
  if (hovered == null) return null;
  const cyl = lay.cylinders.find((c) => c.number === hovered);
  if (!cyl) return null;
  const st = strokeAt(cyl, crankClock.thetaDeg);
  const bank = config.layout === 'inline' ? '' : cyl.bank === 0 ? 'Bank A · ' : 'Bank B · ';
  const pos = lay.firingOrder.indexOf(cyl.number) + 1;
  return (
    <div className="cyl-tip" style={{ transform: `translate(${mouse.current.x + 14}px, ${mouse.current.y + 14}px)` }} data-testid="cyl-tooltip">
      <div className="cyl-tip-h">Cylinder {cyl.number}</div>
      <div className="cyl-tip-row">
        <span>Stroke</span>
        <b className={`stroke-${st}`}>{STROKE_LABEL[st]}</b>
      </div>
      <div className="cyl-tip-row">
        <span>{bank}Firing</span>
        <b>
          {pos}/{lay.cylinders.length} · {Math.round(cyl.firingPhaseDeg)}°
        </b>
      </div>
    </div>
  );
}
