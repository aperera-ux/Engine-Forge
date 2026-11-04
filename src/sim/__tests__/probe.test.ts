const ENV = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
import { it } from 'vitest';
import { simulate } from '../engine';
import { CAL } from '../model/constants';
import { REFERENCE_ENGINES } from '../validation/referenceEngines';
import type { EngineConfig, SimResult } from '../types';
const ref = (id: string) => structuredClone(REFERENCE_ENGINES.find((e) => e.id === id)!.config);
const m = (c: EngineConfig, f: (c: EngineConfig) => void) => { const x = structuredClone(c); f(x); return x; };
const kAt = (r: SimResult, rpms: number[]) => rpms.map((q) => r.curve.reduce((a, b) => (Math.abs(b.rpm - q) < Math.abs(a.rpm - q) ? b : a)).knockRetardDeg.toFixed(0)).join('/');
it('probe', () => {
  const grid = JSON.parse(ENV.GRID ?? '[{}]') as Record<string, number>[];
  const base = structuredClone(CAL);
  for (const g of grid) {
    Object.assign(CAL, structuredClone(base), g);
    const out: string[] = [JSON.stringify(g)];
    const rp = [1500, 2500, 4000, 6000];
    out.push('K20 ' + kAt(simulate(ref('honda-k20a-dc5')), rp));
    out.push('LS3 ' + kAt(simulate(ref('gm-ls3')), rp));
    out.push('EA888 ' + kAt(simulate(ref('vw-ea888-gen3-gti')), rp));
    out.push('B58 ' + kAt(simulate(ref('bmw-b58-340i')), rp));
    for (const id of ['honda-k20a-dc5', 'gm-ls3']) {
      const row = [9, 11, 13, 14, 16].map((cr) => simulate(m(ref(id), (c) => { c.fuel = 'gas87'; c.compressionRatio = cr; })).peakTorqueNm.toFixed(0));
      out.push(id.slice(0, 5) + '87 CR9/11/13/14/16 tq ' + row.join('/'));
    }
    out.push('EA CR8..15 hp ' + [8, 9, 10, 11, 12, 13, 15].map((cr) => simulate(m(ref('vw-ea888-gen3-gti'), (c) => (c.compressionRatio = cr))).peakHp.toFixed(0)).join('/'));
    console.log(out.join(' | '));
  }
});
