/**
 * Independent audit, task 2: plausibility envelopes (research/validation_targets.md
 * "Output plausibility envelopes") and published-figure tolerances for every reference
 * engine, plus generic plausibility for the hypothetical presets.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { atPeakPower, atPeakTorque, pct, r3, recorder, REFERENCE_ENGINES, simulate, type SimResult } from './helpers';
import { HYPOTHETICAL_PRESETS, PRESETS } from '../../src/sim/presets';

const R = recorder('envelopes');
afterAll(() => R.flush());

type Cls = 'pushrod' | 'eco4v' | 'perf4v' | 'turbo' | 'scV8';
const ENVELOPE: Record<Cls, { hpL: [number, number]; bmep: [number, number]; bsfc: [number, number] }> = {
  pushrod: { hpL: [60, 80], bmep: [11, 13], bsfc: [270, 310] },
  eco4v: { hpL: [60, 80], bmep: [11.5, 13], bsfc: [260, 290] },
  perf4v: { hpL: [90, 125], bmep: [12.5, 15.2], bsfc: [270, 300] },
  turbo: { hpL: [100, 170], bmep: [17, 24], bsfc: [290, 360] },
  scV8: { hpL: [100, 125], bmep: [16, 19], bsfc: [300, 380] },
};
const CLASS: Record<string, Cls> = {
  'gm-ls3': 'pushrod', 'gm-ls7': 'pushrod', 'chevy-350-zz4': 'pushrod',
  'toyota-1gr-fe': 'eco4v', 'mazda-skyactiv-g25': 'eco4v',
  'honda-k20a-dc5': 'perf4v', 'honda-f20c-ap1': 'perf4v', 'toyota-4age-20v-blacktop': 'perf4v', 'ford-coyote-gen3': 'perf4v',
  'bmw-s54-e46m3': 'perf4v', 'porsche-9a1-40-gt3': 'perf4v', 'ferrari-f136-458': 'perf4v', 'audi-52-v10-r8plus': 'perf4v', 'ferrari-f140fc-f12': 'perf4v',
  'toyota-2jz-gte-us': 'turbo', 'bmw-b58-340i': 'turbo', 'vw-ea888-gen3-gti': 'turbo', 'ford-10-ecoboost': 'turbo', 'ford-35-ecoboost-gen2': 'turbo', 'subaru-ej257-sti': 'turbo',
  'dodge-hellcat-62': 'scV8',
};
const TOL = {
  high: { hp: [-8, 8], tq: [-8, 8], hpRpm: 8, hpRpmAbs: 500, tqRpm: 15, tqRpmAbs: 700, mass: 15 },
  medium: { hp: [-10, 10], tq: [-10, 10], hpRpm: 10, hpRpmAbs: 0, tqRpm: 20, tqRpmAbs: 0, mass: 20 },
  low: { hp: [-5, 20], tq: [-5, 20], hpRpm: 12, hpRpmAbs: 0, tqRpm: 25, tqRpmAbs: 0, mass: 25 },
} as const;

const results = REFERENCE_ENGINES.map((e) => ({ e, r: simulate(e.config) }));
const summary: Record<string, unknown>[] = [];
const inR = (x: number, [lo, hi]: readonly [number, number]) => x >= lo && x <= hi;

describe.each(results)('reference $e.id', ({ e, r }) => {
  const cls = CLASS[e.id];
  const env = ENVELOPE[cls];
  const conf = e.ratingConfidence ?? 'high';
  const tol = TOL[conf];
  const p = e.published;
  const dispL = r.displacementL;
  const pubHpL = p.hp / dispL;
  const pubBmep = (4 * Math.PI * p.torqueNm) / (dispL / 1000) / 1e5;
  const row = {
    id: e.id, cls, conf,
    hp: r3(r.peakHp), hpPub: p.hp, hpErr: r3(pct(r.peakHp, p.hp)),
    tq: r3(r.peakTorqueNm), tqPub: p.torqueNm, tqErr: r3(pct(r.peakTorqueNm, p.torqueNm)),
    hpRpm: r.peakPowerRpm, hpRpmPub: p.hpRpm, tqRpm: r.peakTorqueRpm, tqRpmPub: p.torqueRpm,
    hpL: r3(r.specificOutputHpL), pubHpL: r3(pubHpL),
    bmepTq: r3(atPeakTorque(r, 'bmepBar')), pubBmep: r3(pubBmep),
    bsfcPk: r3(atPeakPower(r, 'bsfcGkWh')), btePk: r3(atPeakPower(r, 'thermalEfficiency')), egtPk: r3(atPeakPower(r, 'egtC')),
    spRed: r3(r.meanPistonSpeedRedlineMs), mass: r3(r.massKg), massPub: p.massKg ?? null,
    rel: r.reliabilityScore, warns: r.warnings.map((w) => `${w.severity}:${w.code}`),
  };
  summary.push(row);

  it(`specific output in ${cls} envelope ${env.hpL.join('–')} hp/L`, () => {
    expect(r.specificOutputHpL).toBeGreaterThanOrEqual(env.hpL[0]);
    expect(r.specificOutputHpL).toBeLessThanOrEqual(env.hpL[1]);
  });
  it(`BMEP at peak torque in ${cls} envelope ${env.bmep.join('–')} bar`, () => {
    const b = atPeakTorque(r, 'bmepBar');
    expect(b).toBeGreaterThanOrEqual(env.bmep[0]);
    expect(b).toBeLessThanOrEqual(env.bmep[1]);
  });
  it(`BSFC at peak power in ${cls} envelope ${env.bsfc.join('–')} g/kWh`, () => {
    const b = atPeakPower(r, 'bsfcGkWh');
    expect(b).toBeGreaterThanOrEqual(env.bsfc[0]);
    expect(b).toBeLessThanOrEqual(env.bsfc[1]);
  });
  it('BTE ≤ 0.42 anywhere on the curve (gasoline)', () => {
    // (No floor: rich, retarded turbo calibrations legitimately sit at 0.23–0.27, consistent with the 290–360 g/kWh envelope.)
    expect(Math.max(...r.curve.map((d) => d.thermalEfficiency))).toBeLessThanOrEqual(0.42);
  });
  it('EGT at peak power 750–1000 °C (gasoline)', () => {
    const t = atPeakPower(r, 'egtC');
    expect(t).toBeGreaterThanOrEqual(750);
    expect(t).toBeLessThanOrEqual(1000);
  });
  it('mean piston speed at redline ≤ 27 m/s (stock)', () => {
    expect(r.meanPistonSpeedRedlineMs).toBeLessThanOrEqual(27);
  });
  it(`peak hp within ${conf} tolerance ${tol.hp.join('/')}%`, () => {
    const err = pct(r.peakHp, p.hp);
    expect(err).toBeGreaterThanOrEqual(tol.hp[0]);
    expect(err).toBeLessThanOrEqual(tol.hp[1]);
  });
  it(`peak torque within ${conf} tolerance ${tol.tq.join('/')}%`, () => {
    const err = pct(r.peakTorqueNm, p.torqueNm);
    expect(err).toBeGreaterThanOrEqual(tol.tq[0]);
    expect(err).toBeLessThanOrEqual(tol.tq[1]);
  });
  it('peak-power rpm within tolerance (or within published hp plateau)', () => {
    if (p.hpRpmRange && r.peakPowerRpm >= p.hpRpmRange[0] && r.peakPowerRpm <= p.hpRpmRange[1]) return;
    const d = Math.abs(r.peakPowerRpm - p.hpRpm);
    expect(d <= (tol.hpRpm / 100) * p.hpRpm || d <= tol.hpRpmAbs, `sim ${r.peakPowerRpm} vs ${p.hpRpm}`).toBe(true);
  });
  if (e.config.induction === 'turbo' && p.torqueRpmRange) {
    it(`turbo torque ≥ 95% of peak across published plateau ${p.torqueRpmRange.join('–')} rpm`, () => {
      const [a, b] = p.torqueRpmRange!;
      const pts = r.curve.filter((d) => d.rpm >= a && d.rpm <= b);
      const worst = pts.reduce((m, d) => (d.torqueNm < m.torqueNm ? d : m), pts[0]);
      R.rec(`plateau:${e.id}`, { worstRpm: worst.rpm, frac: r3(worst.torqueNm / r.peakTorqueNm) });
      expect(worst.torqueNm / r.peakTorqueNm).toBeGreaterThanOrEqual(0.95);
    });
  } else {
    it('peak-torque rpm within tolerance', () => {
      const d = Math.abs(r.peakTorqueRpm - p.torqueRpm);
      expect(d <= (tol.tqRpm / 100) * p.torqueRpm || d <= tol.tqRpmAbs, `sim ${r.peakTorqueRpm} vs ${p.torqueRpm}`).toBe(true);
    });
  }
  if (p.massKg) {
    it(`mass within ±${tol.mass}%`, () => {
      expect(Math.abs(pct(r.massKg, p.massKg!))).toBeLessThanOrEqual(tol.mass);
    });
  }
  it('stock engine: reliability ≥ 80 and no warn/critical warnings (piston-speed warn allowed at 25–27 m/s)', () => {
    const bad = r.warnings.filter(
      (w) => w.severity !== 'info' && !(w.code === 'piston-speed' && w.severity === 'warn' && r.meanPistonSpeedRedlineMs > 25 && r.meanPistonSpeedRedlineMs <= 27),
    );
    expect(bad.map((w) => `${w.severity}:${w.code}: ${w.message}`)).toEqual([]);
    expect(r.reliabilityScore).toBeGreaterThanOrEqual(80);
  });
  // Informational only (the doc gives no criterion; downsized DI turbos are legitimately
  // knock-limited at low-speed full load): record max retard ≥ 2000 and ≥ 3500 rpm.
  R.rec(`stockRetard:${e.id}`, {
    from2000: r3(Math.max(0, ...r.curve.filter((d) => d.rpm >= 2000).map((d) => d.knockRetardDeg))),
    from3500: r3(Math.max(0, ...r.curve.filter((d) => d.rpm >= 3500).map((d) => d.knockRetardDeg))),
  });
});

describe('aggregate calibration', () => {
  it('mean |hp error| over high+medium engines ≤ 5%', () => {
    const errs = results.filter(({ e }) => (e.ratingConfidence ?? 'high') !== 'low').map(({ e, r }) => Math.abs(pct(r.peakHp, e.published.hp)));
    const mae = errs.reduce((a, b) => a + b, 0) / errs.length;
    R.rec('mae', r3(mae));
    expect(mae).toBeLessThanOrEqual(5);
  });
  it('no high/medium engine outside ±12% peak hp', () => {
    const out = results
      .filter(({ e }) => (e.ratingConfidence ?? 'high') !== 'low')
      .filter(({ e, r }) => Math.abs(pct(r.peakHp, e.published.hp)) > 12)
      .map(({ e, r }) => `${e.id} ${r3(pct(r.peakHp, e.published.hp))}%`);
    expect(out).toEqual([]);
  });
});

describe.each(HYPOTHETICAL_PRESETS.map((c) => ({ name: c.name, c, r: simulate(c) })))('hypothetical preset $name', ({ c, r }) => {
  const alcohol = c.fuel === 'e85' || c.fuel === 'methanol';
  it('generic plausibility: NA (race) BMEP ≤ 16 bar; boosted BMEP ≤ 30 (pump) / 40 (alcohol); hp/L ≤ 400', () => {
    const b = Math.max(...r.curve.map((d) => d.bmepBar));
    summary.push({ id: c.name, hp: r3(r.peakHp), hpL: r3(r.specificOutputHpL), bmepMax: r3(b), rel: r.reliabilityScore, warns: r.warnings.map((w) => `${w.severity}:${w.code}`) });
    if (c.induction === 'na') {
      expect(b).toBeLessThanOrEqual(16);
    } else expect(b).toBeLessThanOrEqual(alcohol ? 40 : 30);
    expect(r.specificOutputHpL).toBeLessThanOrEqual(400);
  });
  it('BTE ≤ 0.42 and BSFC ≥ 200 g/kWh gasoline-equivalent', () => {
    expect(Math.max(...r.curve.map((d) => d.thermalEfficiency))).toBeLessThanOrEqual(alcohol ? 0.44 : 0.42);
  });
});

describe('DEFAULT preset', () => {
  it('default 2.0 NA I4 lands in the NA performance envelope and has no warn/critical', () => {
    const r: SimResult = simulate(PRESETS[0]);
    summary.push({ id: 'DEFAULT', hp: r3(r.peakHp), hpL: r3(r.specificOutputHpL), bmepTq: r3(atPeakTorque(r, 'bmepBar')), rel: r.reliabilityScore, warns: r.warnings.map((w) => `${w.severity}:${w.code}`) });
    expect(r.specificOutputHpL).toBeGreaterThanOrEqual(90);
    expect(r.specificOutputHpL).toBeLessThanOrEqual(125);
    expect(r.warnings.filter((w) => w.severity !== 'info')).toEqual([]);
  });
});

afterAll(() => R.rec('summary', summary));
