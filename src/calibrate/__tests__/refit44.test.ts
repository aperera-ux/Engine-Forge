/**
 * Calibration refit summary over every reference dyno curve (opt-in; skipped in normal runs).
 *
 *   CAL_REFIT44=1 npx vitest run src/calibrate/__tests__/refit44.test.ts
 *
 * Fits each of the 44 published dyno curves (train AND holdout: this measures the
 * per-build calibration tool, not the global model, so no global constant is fitted
 * here) with the full default parameter set and the default OEM-limit policy, and
 * prints mean RMS before / after and how many curves stay above RMS_POOR_PCT.
 * Per-curve lines are printed too (run with --reporter=verbose to see them).
 */
import { describe, expect, it } from 'vitest';
import { oemLimitOptions } from '../../sim/customBuild';
import { DYNO_CURVES, DYNO_ENGINE_BY_ID } from '../../sim/validation/dynoCurves';
import { fitCalibration, RMS_POOR_PCT } from '../fit';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

describe.runIf(!!env.CAL_REFIT44)('calibration refit of all reference dyno curves', () => {
  it('prints the summary', async () => {
    const rows: { id: string; split: string; before: number; after: number; atBound: string[]; values: Record<string, number> }[] = [];
    const t0 = Date.now();
    for (const c of DYNO_CURVES) {
      const e = DYNO_ENGINE_BY_ID[c.engineId];
      const f = await fitCalibration({
        base: e.config,
        simOpts: oemLimitOptions(e.config, e.config),
        measured: { rpm: c.points.map((p) => p.rpm), torqueNm: c.points.map((p) => p.torqueNm) },
      });
      if (!f.ok) throw new Error(`${c.engineId}: ${f.error.message}`);
      rows.push({
        id: c.engineId,
        split: c.split,
        before: f.rmsBeforePct,
        after: f.rmsAfterPct,
        atBound: f.params.filter((p) => p.atBound).map((p) => `${p.id}:${p.atBound}`),
        values: f.values as Record<string, number>,
      });
      console.log(`${c.engineId.padEnd(26)} ${c.split.padEnd(8)} ${f.rmsBeforePct.toFixed(2).padStart(6)} -> ${f.rmsAfterPct.toFixed(2).padStart(6)} %  ${rows[rows.length - 1].atBound.join(' ')}`);
    }
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    const above = rows.filter((r) => r.after > RMS_POOR_PCT);
    console.log(
      `n=${rows.length}: mean RMS before ${mean(rows.map((r) => r.before)).toFixed(3)} %, after ${mean(rows.map((r) => r.after)).toFixed(3)} %; ` +
        `above ${RMS_POOR_PCT} % after: ${above.length} (${above.map((r) => r.id).join(', ')}); ${((Date.now() - t0) / 1000).toFixed(0)} s`,
    );
    expect(rows.length).toBe(DYNO_CURVES.length);
  }, 3_600_000);
});
