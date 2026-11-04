/**
 * Calibration report: predicted vs published for every reference engine.
 * Prints a table (run: npx vitest run src/sim/__tests__/calibration.test.ts)
 * and enforces the calibration targets.
 */
import { describe, expect, it } from 'vitest';
import { simulate } from '../engine';
import { REFERENCE_ENGINES } from '../validation/referenceEngines';

const pct = (a: number, b: number) => (100 * (a - b)) / b;

describe('calibration vs reference engines', () => {
  const rows = REFERENCE_ENGINES.map((e) => {
    const r = simulate(e.config);
    const p = e.published;
    const tqRange = p.torqueRpmRange;
    // For plateau engines: does the simulated curve stay ≥95 % of peak across the published plateau?
    let plateauOk: boolean | null = null;
    let plateauFrac = 1;
    if (tqRange) {
      const inRange = r.curve.filter((d) => d.rpm >= tqRange[0] && d.rpm <= tqRange[1]);
      plateauOk = inRange.length > 0 && inRange.every((d) => d.torqueNm >= 0.95 * r.peakTorqueNm);
      plateauFrac = inRange.length ? inRange.filter((d) => d.torqueNm >= 0.95 * r.peakTorqueNm).length / inRange.length : 0;
    }
    const tqRpmErr = tqRange
      ? r.peakTorqueRpm >= tqRange[0] && r.peakTorqueRpm <= tqRange[1]
        ? 0
        : pct(r.peakTorqueRpm, r.peakTorqueRpm < tqRange[0] ? tqRange[0] : tqRange[1])
      : pct(r.peakTorqueRpm, p.torqueRpm);
    const hpRange = p.hpRpmRange;
    const hpRpmErr = hpRange
      ? r.peakPowerRpm >= hpRange[0] && r.peakPowerRpm <= hpRange[1]
        ? 0
        : pct(r.peakPowerRpm, r.peakPowerRpm < hpRange[0] ? hpRange[0] : hpRange[1])
      : pct(r.peakPowerRpm, p.hpRpm);
    return {
      id: e.id,
      conf: e.ratingConfidence ?? 'high',
      hp: r.peakHp,
      hpPub: p.hp,
      hpErr: pct(r.peakHp, p.hp),
      hpRpm: r.peakPowerRpm,
      hpRpmPub: p.hpRpm,
      hpRpmErr,
      tq: r.peakTorqueNm,
      tqPub: p.torqueNm,
      tqErr: pct(r.peakTorqueNm, p.torqueNm),
      tqRpm: r.peakTorqueRpm,
      tqRpmPub: p.torqueRpm,
      tqRpmErr,
      plateauOk,
      plateauFrac,
      mass: r.massKg,
      massPub: p.massKg,
      knock: r.curve.find((d) => d.rpm === r.peakTorqueRpm)?.knockRetardDeg ?? 0,
      knockP: r.curve.find((d) => d.rpm === r.peakPowerRpm)?.knockRetardDeg ?? 0,
      boost: Math.max(...r.curve.map((d) => d.boostBar)),
      ve: Math.max(...r.curve.map((d) => d.volumetricEfficiency)),
      pmax: Math.max(...r.curve.map((d) => d.peakCylinderPressureBar)),
      egt: Math.max(...r.curve.map((d) => d.egtC)),
      bsfc: r.curve.find((d) => d.rpm === r.peakPowerRpm)?.bsfcGkWh ?? 0,
    };
  });

  const f = (x: number, w = 6, d = 0) => x.toFixed(d).padStart(w);
  const lines = [
    'id                          conf   hp    pub   err%  @rpm   pub  err% |  Nm    pub   err%  @rpm   pub  err% plat | kT   kP  boost  VE   pmax  EGT  bsfc  mass/pub',
    ...rows.map(
      (r) =>
        `${r.id.padEnd(27)} ${r.conf.padEnd(5)}${f(r.hp)}${f(r.hpPub)}${f(r.hpErr, 6, 1)}${f(r.hpRpm)}${f(r.hpRpmPub)}${f(r.hpRpmErr, 6, 1)} |${f(r.tq)}${f(r.tqPub)}${f(r.tqErr, 6, 1)}${f(r.tqRpm)}${f(r.tqRpmPub)}${f(r.tqRpmErr, 6, 1)} ${r.plateauOk === null ? '  -  ' : f(100 * r.plateauFrac, 4) + '%'} |${f(r.knock, 5, 1)}${f(r.knockP, 5, 1)}${f(r.boost, 6, 2)}${f(r.ve, 5, 2)}${f(r.pmax, 6)}${f(r.egt, 5)}${f(r.bsfc, 5)} ${f(r.mass, 4)}/${r.massPub ?? '-'}`,
    ),
  ];
  const scored = rows.filter((r) => r.conf !== 'low');
  const absHp = scored.map((r) => Math.abs(r.hpErr)).sort((a, b) => a - b);
  const median = absHp[Math.floor(absHp.length / 2)];
  const mean = absHp.reduce((a, b) => a + b, 0) / absHp.length;
  const maxHp = Math.max(...absHp);
  const maxTq = Math.max(...scored.map((r) => Math.abs(r.tqErr)));
  lines.push(
    `median|hp err| ${median.toFixed(1)}%  mean ${mean.toFixed(1)}%  max ${maxHp.toFixed(1)}%  max|tq err| ${maxTq.toFixed(1)}%  (excl. low-confidence)`,
  );
  console.log('\n' + lines.join('\n'));

  it('median absolute peak-hp error ≤ 6 % (excluding low-confidence ratings)', () => {
    expect(median).toBeLessThanOrEqual(6);
  });
  it('every engine within ±15 % on peak hp and peak torque (low-confidence B58: −15/+25 %)', () => {
    for (const r of rows) {
      const lo = -15;
      const hi = r.conf === 'low' ? 25 : 15;
      expect(r.hpErr, `${r.id} hp`).toBeGreaterThanOrEqual(lo);
      expect(r.hpErr, `${r.id} hp`).toBeLessThanOrEqual(hi);
      expect(r.tqErr, `${r.id} tq`).toBeGreaterThanOrEqual(lo);
      expect(r.tqErr, `${r.id} tq`).toBeLessThanOrEqual(hi);
    }
  });
  it('peak-torque rpm within ±15 % (or inside the published plateau) for ≥ 15 of the engines', () => {
    expect(rows.filter((r) => Math.abs(r.tqRpmErr) <= 15).length).toBeGreaterThanOrEqual(15);
  });
  it('peak-power rpm within ±15 % for most engines', () => {
    const ok = rows.filter((r) => Math.abs(r.hpRpmErr) <= 15).length;
    expect(ok / rows.length).toBeGreaterThanOrEqual(0.8);
  });
});
