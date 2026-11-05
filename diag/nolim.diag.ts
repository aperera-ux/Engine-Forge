import { it } from 'vitest';
import { DYNO_CURVES } from '../src/sim/validation/dynoCurves';
import { REFERENCE_ENGINES, EXTENDED_REFERENCE_ENGINES } from '../src/sim/validation/referenceEngines';
import { simulate } from '../src/sim/engine';

const ALL = [...REFERENCE_ENGINES, ...EXTENDED_REFERENCE_ENGINES];
const splitOf = (id: string) => DYNO_CURVES.find((c) => c.engineId === id)?.split ?? 'none';
const want = process.env.HOLDOUT === '1' ? ['holdout'] : ['train', 'none'];

it('limits-off turbo score', () => {
  const rows: { id: string; tqOn: number; tqOff: number; hpOn: number; hpOff: number; rmsOn?: number; rmsOff?: number }[] = [];
  for (const e of ALL.filter((x) => x.config.induction !== 'na' && x.config.ecu)) {
    if (!want.includes(splitOf(e.config.name === '' ? '' : (e as unknown as { id: string }).id))) continue;
    const on = simulate(e.config, { applyOemLimits: true });
    const off = simulate(e.config, { applyOemLimits: false });
    const pc = (a: number, b: number) => (100 * (a - b)) / b;
    const row = {
      id: (e as unknown as { id: string }).id,
      tqOn: pc(on.peakTorqueNm, e.published.torqueNm),
      tqOff: pc(off.peakTorqueNm, e.published.torqueNm),
      hpOn: pc(on.peakHp, e.published.hp),
      hpOff: pc(off.peakHp, e.published.hp),
    } as (typeof rows)[number];
    const c = DYNO_CURVES.find((x) => x.engineId === row.id);
    if (c) {
      const rms = (r: ReturnType<typeof simulate>) => {
        let s2 = 0;
        let n = 0;
        for (const p of c.points) {
          const cv = r.curve;
          if (p.rpm < cv[0].rpm || p.rpm > cv[cv.length - 1].rpm) continue;
          let t = cv[cv.length - 1].torqueNm;
          for (let i = 0; i < cv.length - 1; i++)
            if (p.rpm >= cv[i].rpm && p.rpm <= cv[i + 1].rpm) {
              t = cv[i].torqueNm + ((p.rpm - cv[i].rpm) / (cv[i + 1].rpm - cv[i].rpm)) * (cv[i + 1].torqueNm - cv[i].torqueNm);
              break;
            }
          const e2 = (100 * (t - p.torqueNm)) / p.torqueNm;
          s2 += e2 * e2;
          n++;
        }
        return Math.sqrt(s2 / n);
      };
      row.rmsOn = rms(on);
      row.rmsOff = rms(off);
    }
    rows.push(row);
  }
  const f = (x?: number) => (x === undefined ? '  -  ' : x.toFixed(1).padStart(6));
  for (const r of rows) console.log(r.id.padEnd(24), 'pkTq on', f(r.tqOn), 'off', f(r.tqOff), '| pkHp on', f(r.hpOn), 'off', f(r.hpOff), '| curveRMS on', f(r.rmsOn), 'off', f(r.rmsOff));
  const m = (k: 'tqOn' | 'tqOff' | 'hpOn' | 'hpOff') => (rows.reduce((a, r) => a + Math.abs(r[k]), 0) / rows.length).toFixed(2);
  const rm = (k: 'rmsOn' | 'rmsOff') => {
    const v = rows.filter((r) => r[k] !== undefined).map((r) => r[k] as number);
    return (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2);
  };
  console.log(`MEAN|err| n=${rows.length}: pkTq on ${m('tqOn')} off ${m('tqOff')} | pkHp on ${m('hpOn')} off ${m('hpOff')} | curveRMS on ${rm('rmsOn')} off ${rm('rmsOff')}`);
});
