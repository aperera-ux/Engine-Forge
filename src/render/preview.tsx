/** Standalone render harness: /src/render/preview.html?cfg=v8tt&mode=cutaway&rpm=3000 */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_CONFIG } from '../sim/defaults';
import type { EngineConfig } from '../sim/types';
import { EngineScene, visualSpeed } from './index';

const D = DEFAULT_CONFIG;
const P: Record<string, EngineConfig> = {
  i4: D,
  v8tt: {
    ...D, name: 'V8 DOHC twin-turbo', layout: 'v', cylinders: 8, vAngleDeg: 90, crankPlane: 'cross', boreMm: 92, strokeMm: 92.8, rodLengthMm: 150,
    compressionRatio: 9.5, induction: 'turbo', turbo: { ...D.turbo, count: 2, compressorInducerMm: 52, intercoolerEffectiveness: 0.8 }, exhaust: 'long-tube', headerPrimaryMm: 500, headerDiameterMm: 44, intakeRunnerMm: 260, redlineRpm: 7200,
  },
  v8sc: {
    ...D, name: 'Pushrod V8 blown', layout: 'v', cylinders: 8, vAngleDeg: 90, boreMm: 103.25, strokeMm: 92, rodLengthMm: 156, compressionRatio: 9.5, valvetrain: 'pushrod', valvesPerCylinder: 2, intakeValveMm: 54, exhaustValveMm: 40,
    induction: 'supercharger', supercharger: { type: 'roots', targetBoostBar: 0.8, intercoolerEffectiveness: 0 }, exhaust: 'long-tube', headerPrimaryMm: 800, headerDiameterMm: 48, intakeRunnerMm: 180, blockMaterial: 'iron', redlineRpm: 6500,
  },
  v8fp: { ...D, name: 'Flatplane V8 ITB', layout: 'v', cylinders: 8, vAngleDeg: 90, crankPlane: 'flat', boreMm: 94, strokeMm: 81, rodLengthMm: 140, itb: true, intakeRunnerMm: 280, exhaust: 'tuned-equal', headerPrimaryMm: 700, redlineRpm: 9000 },
  flat6: { ...D, name: 'Flat-6', layout: 'flat', cylinders: 6, vAngleDeg: 180, boreMm: 102, strokeMm: 76.4, rodLengthMm: 140, exhaust: 'tuned-equal', headerPrimaryMm: 600, redlineRpm: 9000, intakeRunnerMm: 280 },
  flat4t: { ...D, name: 'Boxer-4 turbo', layout: 'flat', cylinders: 4, vAngleDeg: 180, boreMm: 99.5, strokeMm: 79, rodLengthMm: 130.5, induction: 'turbo', turbo: { ...D.turbo, count: 1, compressorInducerMm: 48 }, exhaust: 'tuned-equal', headerPrimaryMm: 500 },
  v12: { ...D, name: 'V12', layout: 'v', cylinders: 12, vAngleDeg: 65, boreMm: 94, strokeMm: 78, rodLengthMm: 138, compressionRatio: 13.5, exhaust: 'tuned-equal', headerPrimaryMm: 650, intakeRunnerMm: 320, redlineRpm: 9200 },
  v6: { ...D, name: 'V6 60', layout: 'v', cylinders: 6, vAngleDeg: 60, boreMm: 94, strokeMm: 83, rodLengthMm: 155, exhaust: 'log', redlineRpm: 6800, blockMaterial: 'aluminum' },
  i3t: { ...D, name: 'I3 turbo', cylinders: 3, boreMm: 71.9, strokeMm: 82, rodLengthMm: 137, induction: 'turbo', turbo: { ...D.turbo, compressorInducerMm: 38 }, exhaust: 'log', directInjection: true, redlineRpm: 6500, blockMaterial: 'iron' },
  i6sc: { ...D, name: 'I6 centrifugal SOHC', cylinders: 6, boreMm: 84, strokeMm: 89.6, rodLengthMm: 143, valvetrain: 'sohc', valvesPerCylinder: 3, induction: 'supercharger', supercharger: { type: 'centrifugal', targetBoostBar: 0.6, intercoolerEffectiveness: 0.7 }, exhaust: 'shorty' },
  i4ts: { ...D, name: 'I4 twin-screw', induction: 'supercharger', supercharger: { type: 'twin-screw', targetBoostBar: 0.6, intercoolerEffectiveness: 0.6 } },
};

const q = new URLSearchParams(location.search);
const cfgName = q.get('cfg') ?? 'i4';
const mode = (q.get('mode') ?? 'solid') as 'solid' | 'cutaway' | 'xray';
const rpm = Number(q.get('rpm') ?? 3000);
const running = q.get('still') === null;
const quality = (q.get('q') ?? 'high') as 'high' | 'low';
const ts = q.get('ts') ? Number(q.get('ts')) : undefined;

function App() {
  const [hover, setHover] = useState<number | null>(null);
  const [fps, setFps] = useState(0);
  const cfg = P[cfgName] ?? D;
  const vs = visualSpeed(rpm, ts);
  return (
    <div style={{ height: '100%', position: 'relative' }}>
      <EngineScene config={cfg} rpm={rpm} running={running} viewMode={mode} load={Number(q.get('load') ?? 0.8)} egtC={Number(q.get('egt') ?? 820)} timeScale={ts} onCylinderHover={setHover} quality={quality} ao={q.get('ao') === '1'} onFps={setFps} />
      <div id="hud" style={{ position: 'absolute', left: 12, top: 10, pointerEvents: 'none' }}>
        <b>{cfg.name}</b> · {mode} · {rpm} rpm · shown {vs.revPerSec.toFixed(2)} rev/s (×{vs.factor.toFixed(3)}) · cyl {hover ?? '-'} · <span id="fps">{fps.toFixed(0)}</span> fps
        <div style={{ marginTop: 4, opacity: 0.6 }}>{Object.keys(P).map((k) => <a key={k} href={`?cfg=${k}&mode=${mode}`} style={{ color: '#8fc3ff', marginRight: 8, pointerEvents: 'auto' }}>{k}</a>)}</div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
