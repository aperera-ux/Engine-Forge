/**
 * Independent audit, task 3: fuzzing. ~2000 random but valid configs (seeded, so runs are
 * reproducible), ~12% drawn at the extremes of the UI slider ranges.
 * Hard assertions: no NaN/Infinity, no negative outputs, rpm grid strictly increasing,
 * peaks consistent and in range, median simulate time < 20 ms.
 * Plausibility assertions (counted, worst offenders recorded): NA BMEP, BTE, BSFC, NA MAP,
 * EGT, adjacent-point torque jumps on NA curves.
 */
import { afterAll, describe, expect } from 'vitest';
import { gapIt as it } from '../knownGaps';
import { FUELS, r3, recorder, simulate, type DynoPoint, type EngineConfig, type SimResult } from './helpers';
import { SUPPORTED_CYLINDERS } from '../../src/sim/layout';
import type { ExhaustType, FuelType, InductionType, Layout, SuperchargerType, ValvetrainType } from '../../src/sim/types';

const R = recorder('fuzz');
afterAll(() => R.flush());

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N = 2000;
const SEED = 20261104;

export function randomConfig(rnd: () => number, i: number): EngineConfig {
  const extreme = rnd() < 0.12;
  const u = (lo: number, hi: number) => (extreme ? (rnd() < 0.5 ? lo : hi) : lo + (hi - lo) * rnd());
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const layout = pick<Layout>(['inline', 'v', 'flat']);
  const cylinders = pick(SUPPORTED_CYLINDERS[layout]);
  const valvetrain = pick<ValvetrainType>(['pushrod', 'sohc', 'dohc']);
  const vpc = valvetrain === 'pushrod' ? pick([2, 2, 2, 3, 4]) : pick([2, 3, 4, 4, 4, 5]);
  const bore = u(50, 130);
  const stroke = u(40, 130);
  const rod = stroke * u(1.3, 2.4);
  // Valve sizes the UI allows (20–65 / 18–55 mm) but scaled so they roughly fit the bore.
  const iFrac = vpc === 2 ? u(0.4, 0.56) : vpc === 5 ? u(0.28, 0.34) : u(0.34, 0.44);
  const intakeValveMm = Math.min(65, Math.max(20, bore * iFrac));
  const exhaustValveMm = Math.min(55, Math.max(18, intakeValveMm * u(0.75, 0.9)));
  const induction = pick<InductionType>(['na', 'na', 'turbo', 'supercharger']);
  const redlineRpm = Math.round(u(3000, 12000) / 100) * 100;
  return {
    name: `fuzz-${i}`,
    layout,
    cylinders,
    vAngleDeg: layout === 'v' ? Math.round(u(15, 135)) : layout === 'flat' ? 180 : 0,
    crankPlane: rnd() < 0.3 ? 'flat' : 'cross',
    boreMm: bore,
    strokeMm: stroke,
    rodLengthMm: rod,
    compressionRatio: u(6, 16),
    valvetrain,
    valvesPerCylinder: vpc,
    intakeValveMm,
    exhaustValveMm,
    cam: {
      intakeDurationDeg: u(180, 320),
      exhaustDurationDeg: u(180, 320),
      intakeLiftMm: u(6, 20),
      exhaustLiftMm: u(6, 20),
      lobeSeparationDeg: u(100, 122),
      intakeCenterlineDeg: u(95, 125),
      vvt: rnd() < 0.5,
      variableLift: rnd() < 0.3,
    },
    induction,
    turbo: {
      targetBoostBar: u(0.2, 3),
      compressorInducerMm: u(30, 90),
      turbineAR: u(0.4, 1.4),
      intercoolerEffectiveness: u(0, 0.95),
      twinScroll: rnd() < 0.4,
      count: rnd() < 0.3 ? 2 : 1,
    },
    supercharger: { type: pick<SuperchargerType>(['roots', 'twin-screw', 'centrifugal']), targetBoostBar: u(0.1, 2), intercoolerEffectiveness: u(0, 0.95) },
    intakeRunnerMm: u(80, 800),
    throttleMm: u(30, 140),
    itb: rnd() < 0.2,
    exhaust: pick<ExhaustType>(['log', 'shorty', 'long-tube', 'tuned-equal']),
    headerPrimaryMm: u(150, 1400),
    headerDiameterMm: u(25, 70),
    fuel: pick<FuelType>(['gas87', 'gas91', 'gas93', 'race100', 'e85', 'methanol']),
    lambda: u(0.7, 1.05),
    directInjection: rnd() < 0.5,
    redlineRpm,
    idleRpm: Math.min(redlineRpm - 1000, Math.round(u(400, 2000) / 25) * 25),
    blockMaterial: rnd() < 0.4 ? 'iron' : 'aluminum',
    pistons: pick(['cast', 'hypereutectic', 'forged'] as const),
    rods: pick(['cast', 'forged-steel', 'billet-steel', 'titanium'] as const),
    crank: pick(['cast', 'forged', 'billet'] as const),
  };
}

interface Case {
  i: number;
  c: EngineConfig;
  r?: SimResult;
  ms: number;
  err?: string;
}

const rnd = mulberry32(SEED);
const cases: Case[] = [];
// warm-up (JIT) so timing reflects steady-state UI use
for (let k = 0; k < 20; k++) simulate(randomConfig(mulberry32(k + 1), -1));
for (let i = 0; i < N; i++) {
  const c = randomConfig(rnd, i);
  const t0 = performance.now();
  try {
    const r = simulate(c);
    cases.push({ i, c, r, ms: performance.now() - t0 });
  } catch (e) {
    cases.push({ i, c, ms: performance.now() - t0, err: String(e) });
  }
}
const ok = cases.filter((x) => x.r) as Required<Case>[];

const POINT_KEYS: (keyof DynoPoint)[] = [
  'rpm', 'torqueNm', 'powerKw', 'hp', 'torqueLbFt', 'bmepBar', 'imepBar', 'fmepBar', 'volumetricEfficiency', 'mapBar', 'boostBar',
  'airFlowKgS', 'fuelFlowKgH', 'bsfcGkWh', 'thermalEfficiency', 'sparkAdvanceDeg', 'knockRetardDeg', 'egtC', 'chargeTempC',
  'meanPistonSpeedMs', 'peakCylinderPressureBar',
];
const SCALAR_KEYS: (keyof SimResult)[] = [
  'displacementCc', 'peakPowerKw', 'peakHp', 'peakPowerRpm', 'peakTorqueNm', 'peakTorqueRpm', 'specificOutputHpL', 'meanPistonSpeedRedlineMs',
  'maxPistonAccelRedline', 'valveFloatRpm', 'mechanicalLimitRpm', 'massKg', 'hpPerKg', 'reliabilityScore',
];

const brief = (x: Case, extra: Record<string, unknown> = {}) => ({
  i: x.i,
  ...extra,
  cfg: {
    layout: x.c.layout, cyl: x.c.cylinders, bore: r3(x.c.boreMm), stroke: r3(x.c.strokeMm), cr: r3(x.c.compressionRatio), vt: x.c.valvetrain, vpc: x.c.valvesPerCylinder,
    iv: r3(x.c.intakeValveMm), dur: [r3(x.c.cam.intakeDurationDeg), r3(x.c.cam.exhaustDurationDeg)], lift: [r3(x.c.cam.intakeLiftMm), r3(x.c.cam.exhaustLiftMm)],
    lsa: r3(x.c.cam.lobeSeparationDeg), icl: r3(x.c.cam.intakeCenterlineDeg), vvt: x.c.cam.vvt, vl: x.c.cam.variableLift,
    ind: x.c.induction, boost: x.c.induction === 'turbo' ? r3(x.c.turbo.targetBoostBar) : x.c.induction === 'supercharger' ? r3(x.c.supercharger.targetBoostBar) : 0,
    turbo: x.c.induction === 'turbo' ? { ind: r3(x.c.turbo.compressorInducerMm), ar: r3(x.c.turbo.turbineAR), ic: r3(x.c.turbo.intercoolerEffectiveness), n: x.c.turbo.count } : undefined,
    sc: x.c.induction === 'supercharger' ? x.c.supercharger.type : undefined,
    runner: r3(x.c.intakeRunnerMm), thr: r3(x.c.throttleMm), itb: x.c.itb, exh: x.c.exhaust, hdr: [r3(x.c.headerPrimaryMm), r3(x.c.headerDiameterMm)],
    fuel: x.c.fuel, lambda: r3(x.c.lambda), di: x.c.directInjection, red: x.c.redlineRpm, idle: x.c.idleRpm,
  },
});

const offenders: Record<string, { score: number; info: unknown }[]> = {};
const flag = (check: string, x: Case, score: number, extra: Record<string, unknown> = {}) => {
  (offenders[check] ??= []).push({ score, info: brief(x, extra) });
};
afterAll(() => {
  const top: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(offenders)) top[k] = { count: v.length, worst: v.sort((a, b) => b.score - a.score).slice(0, 5).map((o) => o.info) };
  R.rec('offenders', top);
});

describe(`fuzz: ${N} random configs (seed ${SEED})`, () => {
  it('simulate never throws', () => {
    const errs = cases.filter((x) => x.err);
    for (const x of errs) flag('throws', x, 1, { err: x.err });
    expect(errs.map((x) => `${x.i}: ${x.err}`).slice(0, 5)).toEqual([]);
  });

  it('no NaN / Infinity anywhere in the result', () => {
    let n = 0;
    for (const x of ok) {
      const badP = x.r.curve.flatMap((p) => POINT_KEYS.filter((k) => !Number.isFinite(p[k] as number)).map((k) => `${p.rpm}:${k}`));
      const badS = SCALAR_KEYS.filter((k) => !Number.isFinite(x.r[k] as number)).map(String);
      if (badP.length + badS.length) {
        n++;
        flag('non-finite', x, badP.length + badS.length, { fields: [...badS, ...badP].slice(0, 6) });
      }
    }
    expect(n).toBe(0);
  });

  it('no negative power, torque, air/fuel flow, VE, MAP; reliability within 0–100', () => {
    let n = 0;
    for (const x of ok) {
      const neg = x.r.curve.filter((p) => p.powerKw < 0 || p.torqueNm < 0 || p.airFlowKgS < 0 || p.fuelFlowKgH < 0 || p.volumetricEfficiency < 0 || p.mapBar <= 0);
      if (neg.length || x.r.reliabilityScore < 0 || x.r.reliabilityScore > 100) {
        n++;
        flag('negative', x, neg.length);
      }
    }
    expect(n).toBe(0);
  });

  it('rpm grid strictly increasing, ends at redline; peaks equal curve maxima and lie on the grid', () => {
    let n = 0;
    for (const x of ok) {
      const c = x.r.curve;
      let bad = c.length < 5;
      for (let k = 1; k < c.length; k++) if (!(c[k].rpm > c[k - 1].rpm)) bad = true;
      if (c[c.length - 1].rpm !== Math.min(25000, Math.max(1500, x.c.redlineRpm))) bad = true;
      const pk = Math.max(...c.map((p) => p.hp));
      if (Math.abs(pk - x.r.peakHp) > 1e-9 || !c.some((p) => p.rpm === x.r.peakPowerRpm) || !c.some((p) => p.rpm === x.r.peakTorqueRpm)) bad = true;
      if (bad) {
        n++;
        flag('grid/peaks', x, 1);
      }
    }
    expect(n).toBe(0);
  });

  it('specific output ≤ 400 hp/L; a 0-hp result must come with a warn/critical warning explaining it', () => {
    let n = 0;
    for (const x of ok) {
      const explained = x.r.warnings.some((w) => w.severity !== 'info');
      if (x.r.specificOutputHpL > 400 || (!(x.r.peakHp > 0) && !explained)) {
        n++;
        flag('peak-range', x, x.r.specificOutputHpL, { hpL: r3(x.r.specificOutputHpL), hp: r3(x.r.peakHp), warnings: x.r.warnings.map((w) => `${w.severity}:${w.code}`) });
      }
    }
    R.rec('zeroHp', ok.filter((x) => !(x.r.peakHp > 0)).map((x) => ({ i: x.i, warnings: x.r.warnings.map((w) => `${w.severity}:${w.code}`) })));
    expect(n).toBe(0);
  });

  it('identities hold: P = T·ω and BMEP = 4πT/Vd on every point', () => {
    let n = 0;
    for (const x of ok) {
      const vd = x.r.displacementL / 1000;
      const bad = x.r.curve.some(
        (p) => Math.abs(p.powerKw - (p.torqueNm * p.rpm * Math.PI) / 30000) > 1e-3 * Math.max(1, p.powerKw) || Math.abs(p.bmepBar - (4 * Math.PI * p.torqueNm) / vd / 1e5) > 5e-3 * Math.max(1, p.bmepBar),
      );
      if (bad) {
        n++;
        flag('identity', x, 1);
      }
    }
    expect(n).toBe(0);
  });

  it('median simulate time < 20 ms (p95 and max recorded)', () => {
    const t = ok.map((x) => x.ms).sort((a, b) => a - b);
    const q = (f: number) => t[Math.min(t.length - 1, Math.floor(f * t.length))];
    R.rec('timing', { median: r3(q(0.5)), p95: r3(q(0.95)), p99: r3(q(0.99)), max: r3(t[t.length - 1]) });
    const slow = [...ok].sort((a, b) => b.ms - a.ms).slice(0, 5);
    for (const x of slow) flag('slowest', x, x.ms, { ms: r3(x.ms), points: x.r.curve.length });
    expect(q(0.5)).toBeLessThan(20);
  });

  // ── plausibility (physics) ──
  it('NA: MAP never above ambient, boost 0', () => {
    let n = 0;
    for (const x of ok.filter((y) => y.c.induction === 'na')) {
      const m = Math.max(...x.r.curve.map((p) => p.mapBar));
      if (m > 1.01325 + 1e-9 || x.r.curve.some((p) => p.boostBar !== 0)) {
        n++;
        flag('na-map', x, m, { map: r3(m) });
      }
    }
    expect(n).toBe(0);
  });

  it('NA: BMEP ≤ 16 bar on gasoline (doc: > 15.5 street / 16 race NA indicates a bug); ≤ 17.5 on alcohol', () => {
    let n = 0;
    for (const x of ok.filter((y) => y.c.induction === 'na')) {
      const b = Math.max(...x.r.curve.map((p) => p.bmepBar));
      const alc = x.c.fuel === 'e85' || x.c.fuel === 'methanol';
      if (b > (alc ? 17.5 : 16)) {
        n++;
        flag('na-bmep', x, b, { bmep: r3(b), hpL: r3(x.r.specificOutputHpL) });
      }
    }
    R.rec('naBmepViolations', n);
    expect(n).toBe(0);
  });

  it('boosted: BMEP ≤ 30 bar on pump/race gas, ≤ 40 on alcohol', () => {
    let n = 0;
    for (const x of ok.filter((y) => y.c.induction !== 'na')) {
      const b = Math.max(...x.r.curve.map((p) => p.bmepBar));
      const lim = x.c.fuel === 'e85' || x.c.fuel === 'methanol' ? 40 : 30;
      if (b > lim) {
        n++;
        flag('boost-bmep', x, b / lim, { bmep: r3(b) });
      }
    }
    R.rec('boostBmepViolations', n);
    expect(n).toBe(0);
  });

  it('no perpetual motion: BTE ≤ 0.42 gasoline (≤ 0.45 alcohol), BSFC ≥ 200 g/kWh gasoline-equivalent', () => {
    let n = 0;
    for (const x of ok) {
      const alc = x.c.fuel === 'e85' || x.c.fuel === 'methanol';
      const bte = Math.max(...x.r.curve.map((p) => p.thermalEfficiency));
      const bsfcEq = Math.min(...x.r.curve.filter((p) => p.powerKw > 1).map((p) => p.bsfcGkWh * (FUELS[x.c.fuel].lhv / 43e6)));
      if (bte > (alc ? 0.45 : 0.42) || bsfcEq < 200) {
        n++;
        flag('bte', x, bte, { bte: r3(bte), bsfcEq: r3(bsfcEq) });
      }
    }
    R.rec('bteViolations', n);
    expect(n).toBe(0);
  });

  it('EGT at WOT within 500–1100 °C at all points ≥ 1500 rpm (gasoline, λ 0.75–1.0)', () => {
    let n = 0;
    const subset = ok.filter((y) => y.c.fuel.startsWith('gas') && y.c.lambda >= 0.75 && y.c.lambda <= 1.0);
    for (const x of subset) {
      const pts = x.r.curve.filter((p) => p.rpm >= 1500);
      const hi = Math.max(...pts.map((p) => p.egtC));
      const lo = Math.min(...pts.map((p) => p.egtC));
      if (hi > 1100 || lo < 500) {
        n++;
        flag('egt', x, Math.max(hi - 1100, 500 - lo), { egtMin: Math.round(lo), egtMax: Math.round(hi) });
      }
    }
    R.rec('egtViolations', { n, of: subset.length });
    expect(n).toBe(0);
  });

  it('NA torque curves have no adjacent-point jumps > 10% of peak torque (above idle+500 rpm, below float) and ≤ 3 local maxima', () => {
    let jumps = 0;
    let wiggly = 0;
    for (const x of ok.filter((y) => y.c.induction === 'na')) {
      const c = x.r.curve.filter((p) => p.rpm >= x.c.idleRpm + 500);
      let worst = 0;
      let maxima = 0;
      for (let k = 1; k < c.length; k++) {
        // Relative to the curve's peak torque so a curve fading to 0 at a choked top end is not flagged.
        const j = Math.abs(c[k].torqueNm - c[k - 1].torqueNm) / Math.max(1, x.r.peakTorqueNm);
        if (c[k].rpm < x.r.valveFloatRpm) worst = Math.max(worst, j);
        if (k < c.length - 1 && c[k].torqueNm > c[k - 1].torqueNm * 1.005 && c[k].torqueNm > c[k + 1].torqueNm * 1.005) maxima++;
      }
      if (worst > 0.1) {
        jumps++;
        flag('na-torque-jump', x, worst, { jumpPct: r3(100 * worst) });
      }
      if (maxima > 3) {
        wiggly++;
        flag('na-torque-wiggle', x, maxima, { maxima });
      }
    }
    R.rec('naShape', { jumps, wiggly, of: ok.filter((y) => y.c.induction === 'na').length });
    expect(jumps).toBe(0);
    expect(wiggly).toBe(0);
  });

  it('reliability: an engine with critical warnings never scores ≥ 90', () => {
    let n = 0;
    for (const x of ok) {
      if (x.r.warnings.some((w) => w.severity === 'critical') && x.r.reliabilityScore >= 90) {
        n++;
        flag('reliability', x, x.r.reliabilityScore, { rel: x.r.reliabilityScore, crit: x.r.warnings.filter((w) => w.severity === 'critical').map((w) => w.code) });
      }
    }
    expect(n).toBe(0);
  });

  it('summary statistics', () => {
    const hpl = ok.map((x) => x.r.specificOutputHpL).sort((a, b) => a - b);
    R.rec('stats', {
      n: ok.length,
      hpL: { min: r3(hpl[0]), median: r3(hpl[Math.floor(hpl.length / 2)]), max: r3(hpl[hpl.length - 1]) },
      byInduction: Object.fromEntries(['na', 'turbo', 'supercharger'].map((k) => [k, ok.filter((x) => x.c.induction === k).length])),
    });
    expect(ok.length).toBe(N);
  });
});
