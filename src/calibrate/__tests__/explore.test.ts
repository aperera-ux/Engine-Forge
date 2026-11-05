import { it } from 'vitest';
import { REFERENCE_ENGINES } from '../../sim/validation/referenceEngines';
import { oemLimitOptions } from '../../sim/customBuild';
import { fitCalibration } from '../fit';
import { makeFrame, simulateWith } from '../model';
import type { ParamValues } from '../params';

async function trial(id: string, truth: ParamValues, noise = 0, ids?: any) {
  const e = REFERENCE_ENGINES.find((x) => x.id === id)!;
  const opts = oemLimitOptions(e.config, e.config);
  const frame = makeFrame(e.config, opts);
  const r = simulateWith(frame, truth);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5) * 2;
  const pts = r.curve.filter((p) => p.rpm >= 1500);
  const fit = await fitCalibration({
    base: e.config,
    simOpts: opts,
    paramIds: ids,
    measured: { rpm: pts.map((p) => p.rpm), torqueNm: pts.map((p) => p.torqueNm * (1 + noise * rnd())) },
  });
  if (!fit.ok) return console.log(id, fit.error);
  console.log(
    id,
    JSON.stringify(truth),
    `\n  rms ${fit.rmsBeforePct.toFixed(2)} -> ${fit.rmsAfterPct.toFixed(2)} cond ${fit.conditioning.cond.toFixed(1)} ${fit.ms}ms\n  `,
    fit.params.map((p) => `${p.id}=${p.value.toFixed(3)}`).join(' '),
    '\n  ',
    fit.warnings.map((w) => w.code).join(','),
  );
}

it('identifiability explore', async () => {
  await trial('gm-ls3', { veScale: 1.06, fricScale: 1.2, runnerScale: 1.1, camShiftDeg: 3 });
  await trial('gm-ls3', { veScale: 1.06, fricScale: 1.2, runnerScale: 1.1, camShiftDeg: 3 }, 0.01);
  await trial('honda-k20a-dc5', { veScale: 0.95, fricScale: 1.3, runnerScale: 0.9, camShiftDeg: -3 });
  await trial('bmw-b58-340i', { veScale: 0.96, fricScale: 1.2, runnerScale: 1.1, camShiftDeg: 2, boostScale: 1.1, torqueCap: 0.9 });
  await trial('bmw-b58-340i', { runnerScale: 1.1, camShiftDeg: 2, boostScale: 1.1, torqueCap: 0.9 }, 0, ['runnerScale', 'camShiftDeg', 'boostScale', 'torqueCap']);
  await trial('subaru-ej257-sti', { veScale: 1.04, fricScale: 1.2, runnerScale: 1.1, camShiftDeg: -2, boostScale: 1.12, torqueCap: 0.85 });
}, 600000);
