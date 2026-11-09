import { describe, expect } from 'vitest';
import { gapIt as it } from '../../../tests/knownGaps';
import { simulate } from '../engine';
import { DEFAULT_CONFIG } from '../defaults';
import type { EngineConfig, SimResult } from '../types';
import { REFERENCE_ENGINES } from '../validation/referenceEngines';
import { PRESETS } from '../presets';

const ref = (id: string): EngineConfig => {
  const e = REFERENCE_ENGINES.find((r) => r.id === id);
  if (!e) throw new Error(`missing reference ${id}`);
  return structuredClone(e.config);
};
const mod = (c: EngineConfig, f: (c: EngineConfig) => void): EngineConfig => {
  const x = structuredClone(c);
  f(x);
  return x;
};
const torqueAt = (r: SimResult, rpm: number) =>
  r.curve.reduce((a, b) => (Math.abs(b.rpm - rpm) < Math.abs(a.rpm - rpm) ? b : a)).torqueNm;
const maxRetard = (r: SimResult) => Math.max(...r.curve.map((p) => p.knockRetardDeg));
const allFinite = (r: SimResult) => {
  const nums: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'number') nums.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk({ ...r, config: null });
  return nums.every((n) => Number.isFinite(n));
};

const turboI4 = (): EngineConfig =>
  mod(DEFAULT_CONFIG, (c) => {
    c.induction = 'turbo';
    c.compressionRatio = 9.5;
    c.lambda = 0.8;
    c.redlineRpm = 7000;
    c.cam.intakeDurationDeg = 215;
    c.cam.exhaustDurationDeg = 210;
    c.exhaust = 'log';
    c.turbo = { targetBoostBar: 1.0, compressorInducerMm: 52, turbineAR: 0.63, intercoolerEffectiveness: 0.75, twinScroll: false, count: 1 };
  });

describe('units and bookkeeping', () => {
  it('power = torque × ω (300 Nm at 6000 rpm is 188.5 kW)', () => {
    expect((300 * 6000 * 2 * Math.PI) / 60 / 1000).toBeCloseTo(188.5, 1);
    const r = simulate(DEFAULT_CONFIG);
    for (const p of r.curve) {
      expect(p.powerKw).toBeCloseTo((p.torqueNm * p.rpm * 2 * Math.PI) / 60000, 6);
      expect(p.hp).toBeCloseTo((p.powerKw * 1000) / 745.7, 6);
      expect(p.torqueLbFt).toBeCloseTo(p.torqueNm * 0.737562, 4);
      expect(p.bmepBar).toBeCloseTo(Math.max(0, p.imepBar - p.fmepBar), 6);
      expect(p.torqueNm).toBeCloseTo((p.bmepBar * 1e5 * r.displacementL * 1e-3) / (4 * Math.PI), 4);
    }
  });
  it('geometry', () => {
    const r = simulate(DEFAULT_CONFIG);
    expect(r.displacementCc).toBeCloseTo(4 * (Math.PI / 4) * 8.6 ** 2 * 8.6, 0);
    expect(r.meanPistonSpeedRedlineMs).toBeCloseTo((2 * 0.086 * 8000) / 60, 6);
    // a_max = rω²(1 + r/l) at TDC
    const w = (8000 * 2 * Math.PI) / 60;
    expect(r.maxPistonAccelRedline).toBeCloseTo(0.043 * w * w * (1 + 43 / 139), -2);
    expect(r.firingOrder).toBe('1-3-4-2');
  });
  it('NA engine never reports boost and MAP ≤ 1.013 bar', () => {
    const r = simulate(DEFAULT_CONFIG);
    for (const p of r.curve) {
      expect(p.boostBar).toBe(0);
      expect(p.mapBar).toBeLessThanOrEqual(1.0135);
    }
  });
  it('plausible envelopes for the default engine', () => {
    const r = simulate(DEFAULT_CONFIG);
    expect(r.specificOutputHpL).toBeGreaterThan(80);
    expect(r.specificOutputHpL).toBeLessThan(130);
    const pk = r.curve.find((p) => p.rpm === r.peakPowerRpm)!;
    expect(pk.bsfcGkWh).toBeGreaterThan(240);
    expect(pk.bsfcGkWh).toBeLessThan(330);
    expect(pk.egtC).toBeGreaterThan(750);
    expect(pk.egtC).toBeLessThan(1000);
    expect(Math.max(...r.curve.map((p) => p.thermalEfficiency))).toBeLessThan(0.42);
  });
});

describe('directional physics', () => {
  it('more boost → more power (0.5 → 1.0 bar adds 20–45 %)', () => {
    const lo = simulate(mod(turboI4(), (c) => (c.turbo.targetBoostBar = 0.5)));
    const mid = simulate(turboI4());
    const hi = simulate(mod(turboI4(), (c) => (c.turbo.targetBoostBar = 1.4)));
    const gain = mid.peakHp / lo.peakHp - 1;
    expect(gain).toBeGreaterThan(0.2);
    expect(gain).toBeLessThan(0.45);
    expect(hi.peakHp).toBeGreaterThan(mid.peakHp);
  });
  it('higher CR on gas87 → knock retard; CR helps when not knock-limited', () => {
    const base = mod(DEFAULT_CONFIG, (c) => (c.fuel = 'gas87'));
    const r10 = simulate(mod(base, (c) => (c.compressionRatio = 10)));
    const r13 = simulate(mod(base, (c) => (c.compressionRatio = 13)));
    expect(maxRetard(r13)).toBeGreaterThan(maxRetard(r10) + 3);
    const race10 = simulate(mod(DEFAULT_CONFIG, (c) => { c.fuel = 'race100'; c.compressionRatio = 10; }));
    const race11 = simulate(mod(DEFAULT_CONFIG, (c) => { c.fuel = 'race100'; c.compressionRatio = 11; }));
    const g = race11.peakTorqueNm / race10.peakTorqueNm - 1;
    expect(g).toBeGreaterThan(0.01);
    expect(g).toBeLessThan(0.05);
  });
  it('CR 13 NA PFI on gas87 shows substantial knock retard', () => {
    const r = simulate(mod(DEFAULT_CONFIG, (c) => { c.fuel = 'gas87'; c.compressionRatio = 13; }));
    expect(maxRetard(r)).toBeGreaterThan(10);
  });
  it('higher octane never reduces power', () => {
    const fuels = ['gas87', 'gas91', 'gas93', 'race100'] as const;
    const t = turboI4();
    const hp = fuels.map((f) => simulate(mod(t, (c) => (c.fuel = f))).peakHp);
    for (let i = 1; i < hp.length; i++) expect(hp[i]).toBeGreaterThanOrEqual(hp[i - 1] - 0.5);
  });
  it('longer intake runners → lower peak-torque rpm', () => {
    const short = simulate(mod(DEFAULT_CONFIG, (c) => (c.intakeRunnerMm = 150)));
    const long = simulate(mod(DEFAULT_CONFIG, (c) => (c.intakeRunnerMm = 550)));
    expect(long.peakTorqueRpm).toBeLessThan(short.peakTorqueRpm);
  });
  it('bigger cam → peak power at higher rpm, more top end, less low end', () => {
    const base = ref('gm-ls3');
    const big = mod(base, (c) => {
      c.cam.intakeDurationDeg += 24;
      c.cam.exhaustDurationDeg += 24;
      c.cam.lobeSeparationDeg = 112;
      c.cam.intakeCenterlineDeg = 110;
      c.redlineRpm = 7000;
    });
    const b0 = simulate(mod(base, (c) => (c.redlineRpm = 7000)));
    const b1 = simulate(big);
    expect(b1.peakPowerRpm).toBeGreaterThan(b0.peakPowerRpm);
    expect(b1.peakHp).toBeGreaterThan(b0.peakHp);
    expect(torqueAt(b1, 2000)).toBeLessThan(torqueAt(b0, 2000) * 0.97);
  });
  it('more valve area raises top-end power', () => {
    const small = simulate(mod(DEFAULT_CONFIG, (c) => { c.intakeValveMm = 31; }));
    const big = simulate(mod(DEFAULT_CONFIG, (c) => { c.intakeValveMm = 36; }));
    expect(big.peakHp).toBeGreaterThan(small.peakHp * 1.03);
    expect(big.curve.at(-1)!.powerKw).toBeGreaterThan(small.curve.at(-1)!.powerKw);
  });
  it('E85 permits more boost/advance than gas93', () => {
    const hiBoost = mod(turboI4(), (c) => { c.turbo.targetBoostBar = 1.8; c.turbo.compressorInducerMm = 62; });
    const g = simulate(mod(hiBoost, (c) => (c.fuel = 'gas93')));
    const e = simulate(mod(hiBoost, (c) => (c.fuel = 'e85')));
    expect(maxRetard(e)).toBeLessThan(maxRetard(g));
    expect(e.peakHp).toBeGreaterThan(g.peakHp * 1.05);
    const bsfcG = g.curve.find((p) => p.rpm === g.peakPowerRpm)!.bsfcGkWh;
    const bsfcE = e.curve.find((p) => p.rpm === e.peakPowerRpm)!.bsfcGkWh;
    expect(bsfcE / bsfcG).toBeGreaterThan(1.25);
  });
  it('DI lowers knock retard vs PFI', () => {
    const base = mod(DEFAULT_CONFIG, (c) => { c.fuel = 'gas87'; c.compressionRatio = 12.5; });
    const pfi = simulate(base);
    const di = simulate(mod(base, (c) => (c.directInjection = true)));
    expect(maxRetard(di)).toBeLessThan(maxRetard(pfi));
  });
  it('intercooler raises power and lowers charge temperature', () => {
    const none = simulate(mod(turboI4(), (c) => (c.turbo.intercoolerEffectiveness = 0)));
    const ic = simulate(turboI4());
    expect(ic.peakHp).toBeGreaterThan(none.peakHp * 1.04);
    const tc = (r: SimResult) => Math.max(...r.curve.map((p) => p.chargeTempC));
    expect(tc(none) - tc(ic)).toBeGreaterThan(25);
  });
  it('bigger turbo spools later', () => {
    const fullBoostRpm = (r: SimResult) => r.curve.find((p) => p.boostBar >= 0.95)?.rpm ?? Infinity;
    const small = simulate(mod(turboI4(), (c) => { c.turbo.compressorInducerMm = 46; c.turbo.turbineAR = 0.5; }));
    const big = simulate(mod(turboI4(), (c) => { c.turbo.compressorInducerMm = 66; c.turbo.turbineAR = 0.9; }));
    expect(fullBoostRpm(big)).toBeGreaterThan(fullBoostRpm(small));
    const twin = simulate(mod(turboI4(), (c) => { c.turbo.compressorInducerMm = 66; c.turbo.turbineAR = 0.9; c.turbo.twinScroll = true; }));
    expect(fullBoostRpm(twin)).toBeLessThan(fullBoostRpm(big));
  });
  it('PD supercharger: flat boost; centrifugal rises with rpm', () => {
    const sc = (type: 'roots' | 'twin-screw' | 'centrifugal') =>
      simulate(mod(DEFAULT_CONFIG, (c) => {
        c.induction = 'supercharger';
        c.compressionRatio = 9.5;
        c.lambda = 0.8;
        c.supercharger = { type, targetBoostBar: 0.6, intercoolerEffectiveness: 0.6 };
      }));
    const ts = sc('twin-screw');
    const cf = sc('centrifugal');
    const roots = sc('roots');
    const mid = (r: SimResult) => r.curve.find((p) => p.rpm >= 4000)!;
    expect(mid(ts).boostBar).toBeGreaterThan(0.45);
    expect(mid(cf).boostBar).toBeLessThan(0.55 * mid(ts).boostBar); // centrifugal ∝ rpm², PD near-flat
    expect(torqueAt(ts, 3500)).toBeGreaterThan(torqueAt(cf, 3500));
    expect(roots.peakHp).toBeLessThan(ts.peakHp);
  });
  it('lambda: best power near 0.85–0.90, lean loses power', () => {
    const hp = (l: number) => simulate(mod(DEFAULT_CONFIG, (c) => (c.lambda = l))).peakHp;
    expect(hp(0.88)).toBeGreaterThan(hp(1.0));
    expect(hp(0.88)).toBeGreaterThan(hp(0.72));
    expect(hp(1.0)).toBeGreaterThan(hp(1.15));
  });
  it('raising redline past valve float does not add power', () => {
    const r = simulate(mod(ref('gm-ls3'), (c) => (c.redlineRpm = 9000)));
    expect(r.valveFloatRpm).toBeLessThan(9000);
    expect(r.peakPowerRpm).toBeLessThan(r.valveFloatRpm * 1.05);
    expect(r.warnings.some((w) => w.code === 'valve-float')).toBe(true);
  });
  it('forged internals raise mechanicalLimitRpm', () => {
    const cast = simulate(mod(DEFAULT_CONFIG, (c) => { c.pistons = 'cast'; c.rods = 'cast'; c.crank = 'cast'; }));
    const forged = simulate(mod(DEFAULT_CONFIG, (c) => { c.pistons = 'forged'; c.rods = 'forged-steel'; c.crank = 'forged'; }));
    const billet = simulate(mod(DEFAULT_CONFIG, (c) => { c.pistons = 'forged'; c.rods = 'titanium'; c.crank = 'billet'; }));
    expect(forged.mechanicalLimitRpm).toBeGreaterThan(cast.mechanicalLimitRpm * 1.1);
    expect(billet.mechanicalLimitRpm).toBeGreaterThan(forged.mechanicalLimitRpm);
  });
  it('pushrod floats earlier than DOHC; iron block is heavier', () => {
    const p = simulate(mod(DEFAULT_CONFIG, (c) => (c.valvetrain = 'pushrod')));
    expect(p.valveFloatRpm).toBeLessThan(simulate(DEFAULT_CONFIG).valveFloatRpm);
    const iron = simulate(mod(DEFAULT_CONFIG, (c) => (c.blockMaterial = 'iron')));
    expect(iron.massKg).toBeGreaterThan(simulate(DEFAULT_CONFIG).massKg + 10);
  });
  it('piston speed warnings', () => {
    const r = simulate(mod(DEFAULT_CONFIG, (c) => { c.strokeMm = 100; c.redlineRpm = 8500; }));
    expect(r.warnings.find((w) => w.code === 'piston-speed')?.severity).toBe('warn'); // 28.3 m/s
    expect(r.reliabilityScore).toBeLessThan(simulate(DEFAULT_CONFIG).reliabilityScore);
    const crit = simulate(mod(DEFAULT_CONFIG, (c) => { c.strokeMm = 100; c.redlineRpm = 9500; }));
    expect(crit.warnings.find((w) => w.code === 'piston-speed')?.severity).toBe('critical'); // 31.7 m/s
  });
});

describe('stock engines look healthy', () => {
  it('every reference engine: reliability ≥ 80 and no warn/critical warnings', () => {
    for (const e of REFERENCE_ENGINES) {
      const r = simulate(e.config);
      const bad = r.warnings.filter((w) => w.severity !== 'info');
      expect(bad.map((w) => `${w.code}: ${w.message}`), e.id).toEqual([]);
      expect(r.reliabilityScore, e.id).toBeGreaterThanOrEqual(80);
    }
  });
  it('abused engines still warn: CR 13 PFI turbo on gas87, over-revved cast LS3', () => {
    const t = mod(turboI4(), (c) => { c.fuel = 'gas87'; c.compressionRatio = 11.5; c.turbo.targetBoostBar = 1.6; });
    expect(simulate(t).warnings.some((w) => w.code === 'knock' && w.severity !== 'info')).toBe(true);
    const ls = mod(ref('gm-ls3'), (c) => { c.redlineRpm = 8500; c.rods = 'cast'; });
    const r = simulate(ls);
    expect(r.warnings.some((w) => w.code === 'rotating-assembly' && w.severity !== 'info')).toBe(true);
    expect(r.reliabilityScore).toBeLessThan(80);
  });
  it('dyno curve starts at max(idle, 1000) rpm', () => {
    expect(simulate(DEFAULT_CONFIG).curve[0].rpm).toBe(1000);
  });
});

describe('balance from crank geometry', () => {
  const bal = (f: (c: EngineConfig) => void) => simulate(mod(DEFAULT_CONFIG, f)).balance;
  it('I4: only the secondary force is unbalanced', () => {
    const b = bal(() => {});
    expect(b).toMatchObject({ primaryForce: 'balanced', primaryCouple: 'balanced', secondaryForce: 'unbalanced', secondaryCouple: 'balanced' });
  });
  it('I6, flat-6, V12 are fully balanced', () => {
    const full = { primaryForce: 'balanced', primaryCouple: 'balanced', secondaryForce: 'balanced', secondaryCouple: 'balanced' };
    expect(bal((c) => (c.cylinders = 6))).toMatchObject(full);
    expect(bal((c) => { c.layout = 'flat'; c.cylinders = 6; c.vAngleDeg = 180; })).toMatchObject(full);
    expect(bal((c) => { c.layout = 'v'; c.cylinders = 12; c.vAngleDeg = 60; })).toMatchObject(full);
  });
  it('crossplane V8 balanced (couple cancelled by counterweights); flat-plane V8 secondary force', () => {
    expect(bal((c) => { c.layout = 'v'; c.cylinders = 8; c.vAngleDeg = 90; c.crankPlane = 'cross'; })).toMatchObject({
      primaryForce: 'balanced', primaryCouple: 'balanced', secondaryForce: 'balanced', secondaryCouple: 'balanced',
    });
    expect(bal((c) => { c.layout = 'v'; c.cylinders = 8; c.vAngleDeg = 90; c.crankPlane = 'flat'; }).secondaryForce).toBe('unbalanced');
  });
  it('V6 60° has a rocking couple; boxer-4 has a secondary couple; I3 primary couple; single unbalanced', () => {
    // Split-pin 60° V6: primary couple rotates with the crank (counterweighted); a secondary rocking couple remains.
    const v6 = bal((c) => { c.layout = 'v'; c.cylinders = 6; c.vAngleDeg = 60; });
    expect(v6.primaryForce).toBe('balanced');
    expect(v6.primaryCouple === 'unbalanced' || v6.secondaryCouple === 'unbalanced').toBe(true);
    expect(bal((c) => (c.cylinders = 5))).toMatchObject({ primaryCouple: 'unbalanced', secondaryCouple: 'unbalanced' });
    const boxer = bal((c) => { c.layout = 'flat'; c.cylinders = 4; c.vAngleDeg = 180; });
    expect(boxer).toMatchObject({ primaryForce: 'balanced', secondaryForce: 'balanced', secondaryCouple: 'unbalanced' });
    expect(bal((c) => (c.cylinders = 3)).primaryCouple).toBe('unbalanced');
    expect(bal((c) => (c.cylinders = 1)).primaryForce).toBe('unbalanced');
  });
});

describe('robustness and performance', () => {
  it('no NaN/Infinity on extreme but valid inputs', () => {
    const extremes: EngineConfig[] = [
      mod(DEFAULT_CONFIG, (c) => { c.cylinders = 1; c.boreMm = 40; c.strokeMm = 30; c.redlineRpm = 18000; }),
      mod(DEFAULT_CONFIG, (c) => { c.layout = 'v'; c.cylinders = 16; c.boreMm = 140; c.strokeMm = 160; c.redlineRpm = 3000; c.idleRpm = 500; }),
      mod(turboI4(), (c) => { c.turbo.targetBoostBar = 4; c.turbo.compressorInducerMm = 30; c.fuel = 'gas87'; c.compressionRatio = 14; }),
      mod(turboI4(), (c) => { c.turbo.targetBoostBar = 3; c.turbo.compressorInducerMm = 100; c.turbo.turbineAR = 1.4; c.fuel = 'methanol'; c.lambda = 0.7; }),
      mod(DEFAULT_CONFIG, (c) => { c.intakeValveMm = 60; c.cam.intakeLiftMm = 25; c.cam.intakeDurationDeg = 330; c.throttleMm = 15; c.lambda = 1.4; }),
      mod(DEFAULT_CONFIG, (c) => { c.rodLengthMm = 50; c.compressionRatio = 20; c.intakeRunnerMm = 0; c.headerPrimaryMm = 50; c.valvesPerCylinder = 2; }),
      mod(DEFAULT_CONFIG, (c) => { c.induction = 'supercharger'; c.supercharger = { type: 'roots', targetBoostBar: 4, intercoolerEffectiveness: 0 }; }),
    ];
    for (const c of extremes) {
      const r = simulate(c);
      expect(allFinite(r)).toBe(true);
      expect(r.curve.length).toBeGreaterThan(5);
      expect(r.peakHp).toBeGreaterThanOrEqual(0);
    }
  });
  it('all reference engines and presets simulate finitely', () => {
    for (const e of REFERENCE_ENGINES) expect(allFinite(simulate(e.config)), e.id).toBe(true);
    for (const p of PRESETS) expect(allFinite(simulate(p)), p.name).toBe(true);
  });
  it('simulate < 15 ms', () => {
    const cfgs = [DEFAULT_CONFIG, turboI4(), ref('ferrari-f140fc-f12'), ref('ford-35-ecoboost-gen2')];
    for (const c of cfgs) simulate(c); // warm-up
    for (const c of cfgs) {
      const n = 10;
      const t0 = performance.now();
      for (let i = 0; i < n; i++) simulate(c);
      const dt = (performance.now() - t0) / n;
      expect(dt, c.name).toBeLessThan(15);
    }
  });
});
