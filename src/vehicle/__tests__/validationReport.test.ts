import { describe, it } from 'vitest';

const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
import { evaluateAll, formatTable, summarize } from '../validation/run';

// Holdout rows are only printed with HOLDOUT=1 (final scoring), to avoid peeking while tuning.
describe('vehicle validation report (informational)', () => {
  it('prints tables', () => {
    const showHoldout = !!ENV.HOLDOUT;
    for (const src of ['published', 'simulated'] as const) {
      const rows = evaluateAll(src).filter((r) => showHoldout || r.car.split === 'train');
      const tr = rows.filter((r) => r.car.split === 'train');
      const ho = rows.filter((r) => r.car.split === 'holdout');
      console.log(`\n=== ${src} ===\n${formatTable(rows)}\nTRAIN ${JSON.stringify(summarize(tr))}` + (showHoldout ? `\nHOLDOUT ${JSON.stringify(summarize(ho))}` : ''));
    }
  });
});
