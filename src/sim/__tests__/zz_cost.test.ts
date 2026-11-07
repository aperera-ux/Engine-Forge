import { it } from 'vitest';
import { PRESETS } from '../presets';
import { EXTENDED_REFERENCE_ENGINES } from '../validation/referenceEngines';
import { pointSolveStats, setBreathingCache, simulate } from '../engine';
it('cost', () => {
  const want = (process.env.NAMES ?? 'B58,1.8 TFSI,EA113,EcoBoost,EA888 Gen 3').split(',');
  if (process.env.COLD) setBreathingCache(false);
  for (const c of [...PRESETS, ...EXTENDED_REFERENCE_ENGINES.map((e) => e.config)]) {
    if (!want.some((w) => c.name.includes(w))) continue;
    simulate(c);
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) simulate(c);
    const dt = (performance.now() - t0) / 10;
    console.log(`COST ${c.name.slice(0, 30).padEnd(30)} ${dt.toFixed(2)} ms ${JSON.stringify(pointSolveStats)}`);
  }
});
