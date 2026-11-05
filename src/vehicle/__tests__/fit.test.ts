import { describe, it } from 'vitest';

const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
import { gridFit } from '../validation/fit';

// Only runs with FIT=1: `FIT=1 npx vitest run src/vehicle/__tests__/fit.test.ts --silent=false`
describe.skipIf(!ENV.FIT)('global parameter fit (train only)', () => {
  it('grid search', { timeout: 120000 }, () => {
    const mu = Array.from({ length: 13 }, (_, i) => 1.2 + i * 0.05);
    const eta = Array.from({ length: 8 }, (_, i) => 0.88 + i * 0.01);
    console.log('BEST', JSON.stringify(gridFit(mu, eta, [0.12, 0.14, 0.17, 0.2, 0.3], [0, 1])));
  });
});
