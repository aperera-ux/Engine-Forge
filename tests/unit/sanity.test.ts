/**
 * Independent audit: the 25 qualitative sanity rules of research/validation_targets.md §2,
 * each as a one-variable-at-a-time perturbation of a reference engine, across several
 * base engines. Plus physics identities on every dyno point.
 *
 * Tolerances are the research doc's numbers; where the doc gives a "roughly" band the
 * accepted window is widened modestly (stated inline) — never to make a test pass.
 * Failing tests are real findings: see tests/reports/physics_audit.md.
 */
import { afterAll, describe, expect, it } from 'vitest';
import {
  at,
  atPeakPower,
  base,
  BASES,
  FUELS,
  max,
  mutate,
  pct,
  r3,
  recorder,
  ref,
  REFERENCE_ENGINES,
  simulate,
  spoolRpm,
  torqueArea,
  type EngineConfig,
  type SimResult,
} from './helpers';
import { HYPOTHETICAL_PRESETS, PRESETS } from '../../src/sim/presets';
import { camCandidates, inletMachIndex } from '../../src/sim/model/airflow';
import { computeGeometry, sanitize } from '../../src/sim/model/geometry';

const R = recorder('sanity');
afterAll(() => R.flush());

const sim = (c: EngineConfig) => simulate(c);
const maxRetard = (r: SimResult, fromRpm = 1500) =>
  Math.max(0, ...r.curve.filter((p) => p.rpm >= fromRpm).map((p) => p.knockRetardDeg));
const warnCodes = (r: SimResult, sev: string[] = ['warn', 'critical']) =>
  r.warnings.filter((w) => sev.includes(w.severity)).map((w) => w.code);
const hasCode = (r: SimResult, code: string, sev: string[] = ['warn', 'critical']) => warnCodes(r, sev).includes(code);

// ─────────────────────────────── Physics identities ───────────────────────────────
describe('physics identities on every curve point', () => {
  const engines: { name: string; c: EngineConfig }[] = [
    ...REFERENCE_ENGINES.map((e) => ({ name: e.id, c: e.config })),
    ...HYPOTHETICAL_PRESETS.map((c) => ({ name: c.name, c })),
    { name: 'DEFAULT', c: PRESETS[0] },
  ];
  const results = engines.map((e) => ({ ...e, r: sim(e.c) }));
  const vdTotal = (r: SimResult) => r.displacementL / 1000;
  const RHO = 101325 / (287.05 * 298.15);

  const check = (label: string, f: (r: SimResult, c: EngineConfig) => string[]) => {
    it(label, () => {
      const bad: string[] = [];
      for (const { name, c, r } of results) for (const m of f(r, c)) bad.push(`${name}: ${m}`);
      R.rec(`identity:${label}`, bad.slice(0, 40));
      expect(bad, bad.slice(0, 12).join('\n')).toEqual([]);
    });
  };

  check('power = torque·ω (0.1%)', (r) =>
    r.curve
      .filter((p) => Math.abs(p.powerKw - (p.torqueNm * p.rpm * 2 * Math.PI) / 60000) > 1e-3 * Math.max(1, p.powerKw))
      .map((p) => `${p.rpm} rpm P=${p.powerKw}`),
  );
  check('hp = kW/0.7457 and lb-ft = N·m·0.73756', (r) =>
    r.curve
      .filter((p) => Math.abs(p.hp - p.powerKw / 0.7457) > 1e-3 * Math.max(1, p.hp) || Math.abs(p.torqueLbFt - p.torqueNm * 0.737562) > 1e-2)
      .map((p) => `${p.rpm} rpm`),
  );
  check('BMEP = 4π·T/Vd (0.5%)', (r) =>
    r.curve
      .filter((p) => Math.abs(p.bmepBar - (4 * Math.PI * p.torqueNm) / vdTotal(r) / 1e5) > 5e-3 * Math.max(1, p.bmepBar))
      .map((p) => `${p.rpm} rpm bmep=${r3(p.bmepBar)} vs ${r3((4 * Math.PI * p.torqueNm) / vdTotal(r) / 1e5)}`),
  );
  check('IMEP − FMEP = BMEP (where BMEP > 0)', (r) =>
    r.curve
      .filter((p) => p.bmepBar > 0 && Math.abs(p.imepBar - p.fmepBar - p.bmepBar) > 0.02)
      .map((p) => `${p.rpm} rpm imep ${r3(p.imepBar)} fmep ${r3(p.fmepBar)} bmep ${r3(p.bmepBar)}`),
  );
  check('BSFC = fuel flow / power (1%)', (r) =>
    r.curve
      .filter((p) => p.powerKw > 1)
      .filter((p) => Math.abs(p.bsfcGkWh - (p.fuelFlowKgH * 1000) / p.powerKw) > 0.01 * p.bsfcGkWh)
      .map((p) => `${p.rpm} rpm bsfc=${r3(p.bsfcGkWh)} vs ${r3((p.fuelFlowKgH * 1000) / p.powerKw)}`),
  );
  check('fuel flow = air flow / (λ·AFR_stoich) (1%)', (r, c) =>
    r.curve
      .filter((p) => Math.abs(p.fuelFlowKgH - (p.airFlowKgS * 3600) / (c.lambda * FUELS[c.fuel].afr)) > 0.01 * p.fuelFlowKgH)
      .map((p) => `${p.rpm} rpm`),
  );
  check('BTE = P/(ṁf·LHV) within 2%', (r, c) =>
    r.curve
      .filter((p) => p.powerKw > 1)
      .filter((p) => {
        const bte = (p.powerKw * 1000) / ((p.fuelFlowKgH / 3600) * FUELS[c.fuel].lhv);
        return Math.abs(p.thermalEfficiency - bte) > 0.02 * bte;
      })
      .map((p) => `${p.rpm} rpm`),
  );
  check('VE·Vd·ρ_amb·rpm/120 ≈ air flow (2%)', (r) =>
    r.curve
      .filter((p) => {
        const m = (p.volumetricEfficiency * vdTotal(r) * RHO * p.rpm) / 120;
        return Math.abs(m - p.airFlowKgS) > 0.02 * p.airFlowKgS;
      })
      .map((p) => `${p.rpm} rpm VE=${r3(p.volumetricEfficiency)}`),
  );
  check('NA: MAP ≤ ambient and boost = 0', (r, c) =>
    c.induction !== 'na' ? [] : r.curve.filter((p) => p.mapBar > 1.01325 + 1e-6 || p.boostBar !== 0).map((p) => `${p.rpm} MAP ${r3(p.mapBar)}`),
  );
  check('EGT 500–1100 °C at WOT (all points ≥ 1500 rpm)', (r) =>
    r.curve.filter((p) => p.rpm >= 1500 && (p.egtC < 500 || p.egtC > 1100)).map((p) => `${p.rpm} rpm EGT ${Math.round(p.egtC)}`),
  );
  check('BSFC ≥ 200 g/kWh gasoline-equivalent (no perpetual motion)', (r, c) =>
    r.curve
      .filter((p) => p.powerKw > 1 && p.bsfcGkWh * (FUELS[c.fuel].lhv / 43e6) < 200)
      .map((p) => `${p.rpm} rpm bsfc ${Math.round(p.bsfcGkWh)}`),
  );
  check('BTE ≤ 0.42 (gasoline); ≤ 0.44 alcohols', (r, c) =>
    r.curve
      .filter((p) => p.thermalEfficiency > (c.fuel === 'e85' || c.fuel === 'methanol' ? 0.44 : 0.42))
      .map((p) => `${p.rpm} rpm BTE ${r3(p.thermalEfficiency)}`),
  );
  check('peaks reported = curve maxima; rpm strictly increasing', (r) => {
    const out: string[] = [];
    if (Math.abs(r.peakHp - max(r, 'hp')) > 1e-6) out.push('peakHp');
    if (Math.abs(r.peakTorqueNm - max(r, 'torqueNm')) > 1e-6) out.push('peakTorque');
    for (let i = 1; i < r.curve.length; i++) if (r.curve[i].rpm <= r.curve[i - 1].rpm) out.push(`rpm order @${i}`);
    if (r.curve[r.curve.length - 1].rpm !== r.config.redlineRpm) out.push('last point ≠ redline');
    return out;
  });
});

// ─────────────────────────────── 1–6 Induction & boost ───────────────────────────────
describe('Rule 1: more boost → more power (until knock/choke/EGT)', () => {
  for (const k of ['turboI4', 'turboI6'] as const) {
    it(`${k}: peak hp non-decreasing in boost 0.4→2.0 bar (unless knock-retard/choke grows)`, () => {
      const b = base(k);
      const rows = [0.4, 0.6, 0.8, 1.0, 1.2, 1.5, 1.8, 2.0].map((bar) => {
        const r = sim(mutate(b, (c) => (c.turbo.targetBoostBar = bar)));
        return { bar, hp: r.peakHp, retard: maxRetard(r), maxBoost: max(r, 'boostBar'), choke: r.warnings.some((w) => w.code === 'compressor-choke') };
      });
      R.rec(`r1:${k}:sweep`, rows.map((x) => ({ ...x, hp: r3(x.hp), retard: r3(x.retard), maxBoost: r3(x.maxBoost) })));
      for (let i = 1; i < rows.length; i++) {
        const limited = rows[i].retard > rows[i - 1].retard + 0.5 || rows[i].choke || rows[i].maxBoost < rows[i].bar * 0.95;
        if (!limited) expect(rows[i].hp, `hp at ${rows[i].bar} bar`).toBeGreaterThanOrEqual(rows[i - 1].hp * 0.995);
      }
    });
    it(`${k}: 0.5 → 1.0 bar adds 25–40% peak power`, () => {
      const b = base(k);
      const h = (bar: number) => sim(mutate(b, (c) => (c.turbo.targetBoostBar = bar))).peakHp;
      const gain = pct(h(1.0), h(0.5));
      R.rec(`r1:${k}:gain0.5to1.0`, r3(gain));
      expect(gain).toBeGreaterThanOrEqual(25);
      expect(gain).toBeLessThanOrEqual(40);
    });
  }
  it('SC V8: peak hp rises 0.4 → 0.8 → 1.2 bar', () => {
    const b = base('scV8');
    const hp = [0.4, 0.8, 1.2].map((x) => sim(mutate(b, (c) => (c.supercharger.targetBoostBar = x))).peakHp);
    R.rec('r1:scV8', hp.map(r3));
    expect(hp[1]).toBeGreaterThan(hp[0]);
    expect(hp[2]).toBeGreaterThan(hp[1]);
  });
  // 2.0 L at CR 9.5 on 93 with a compressor big enough not to choke.
  const twoLiter = (fuel: EngineConfig['fuel'], bar: number) =>
    mutate(base('turboI4'), (c) => {
      c.compressionRatio = 9.5;
      c.fuel = fuel;
      c.turbo.compressorInducerMm = 62;
      c.turbo.turbineAR = 0.7;
      c.turbo.targetBoostBar = bar;
    });
  it('2.0 CR 9.5 on gas93: knock retard rises beyond ~1.5 bar', () => {
    const rows = [1.0, 1.5, 2.0, 2.5].map((bar) => ({ bar, retard: maxRetard(sim(twoLiter('gas93', bar))) }));
    R.rec('r1:2.0L-gas93-retard', rows.map((x) => ({ bar: x.bar, retard: r3(x.retard) })));
    expect(rows[2].retard).toBeGreaterThan(rows[1].retard + 2);
    expect(rows[3].retard).toBeGreaterThan(rows[2].retard);
  });
  it('2.0 CR 9.5 on E85 keeps gaining power beyond 2 bar and retards far less than 93', () => {
    const e2 = sim(twoLiter('e85', 2.0));
    const e25 = sim(twoLiter('e85', 2.5));
    const g2 = sim(twoLiter('gas93', 2.0));
    R.rec('r1:2.0L-e85', { hp2: r3(e2.peakHp), hp25: r3(e25.peakHp), retE85: r3(maxRetard(e2)), retG93: r3(maxRetard(g2)) });
    expect(e25.peakHp).toBeGreaterThan(e2.peakHp * 1.05);
    expect(maxRetard(e2)).toBeLessThan(maxRetard(g2) - 3);
  });
});

describe('Rule 2: compressor inducer / turbine A/R trade-off', () => {
  for (const k of ['turboI4', 'turboI6'] as const) {
    const hi = (c: EngineConfig) => (c.turbo.targetBoostBar = 1.5);
    it(`${k}: bigger inducer → later spool, more peak power at 1.5 bar; smaller → more low-rpm torque`, () => {
      const b = base(k);
      const small = sim(mutate(b, (c) => (hi(c), (c.turbo.compressorInducerMm = b.turbo.compressorInducerMm * 0.85))));
      const big = sim(mutate(b, (c) => (hi(c), (c.turbo.compressorInducerMm = b.turbo.compressorInducerMm * 1.3))));
      const row = {
        spoolSmall: spoolRpm(small, 1.5), spoolBig: spoolRpm(big, 1.5),
        hpSmall: r3(small.peakHp), hpBig: r3(big.peakHp),
        tq2000Small: r3(at(small, 2000)), tq2000Big: r3(at(big, 2000)),
      };
      R.rec(`r2:${k}:inducer`, row);
      expect(row.spoolBig).toBeGreaterThanOrEqual(row.spoolSmall);
      expect(big.peakHp).toBeGreaterThan(small.peakHp);
      expect(at(small, 2000)).toBeGreaterThanOrEqual(at(big, 2000) * 0.99);
    });
    it(`${k}: bigger turbine A/R → later spool, more top-end, lower back pressure at redline`, () => {
      const b = base(k);
      const small = sim(mutate(b, (c) => (hi(c), (c.turbo.turbineAR = 0.45))));
      const big = sim(mutate(b, (c) => (hi(c), (c.turbo.turbineAR = 1.0))));
      const last = (r: SimResult) => r.curve[r.curve.length - 1];
      const row = {
        spoolSmall: spoolRpm(small, 1.5), spoolBig: spoolRpm(big, 1.5),
        hpSmall: r3(small.peakHp), hpBig: r3(big.peakHp),
        pExhRedSmall: r3(last(small).exhaustPressureBar ?? NaN), pExhRedBig: r3(last(big).exhaustPressureBar ?? NaN),
        tq2500Small: r3(at(small, 2500)), tq2500Big: r3(at(big, 2500)),
      };
      R.rec(`r2:${k}:AR`, row);
      expect(row.spoolBig).toBeGreaterThan(row.spoolSmall);
      expect(big.peakHp).toBeGreaterThanOrEqual(small.peakHp);
      expect(row.pExhRedBig).toBeLessThan(row.pExhRedSmall);
      expect(at(small, 2500)).toBeGreaterThan(at(big, 2500));
    });
  }
});

describe('Rule 3: twin-scroll spools earlier, same peak', () => {
  for (const k of ['turboI4', 'turboI6'] as const) {
    it(`${k}: full-boost rpm 5–20% lower (doc: 10–15%), peak hp within ±4%`, () => {
      const b = mutate(base(k), (c) => (c.turbo.compressorInducerMm *= 1.2)); // make spool visible
      const off = sim(mutate(b, (c) => (c.turbo.twinScroll = false)));
      const on = sim(mutate(b, (c) => (c.turbo.twinScroll = true)));
      const t = b.turbo.targetBoostBar;
      const row = { spoolOff: spoolRpm(off, t), spoolOn: spoolRpm(on, t), hpOff: r3(off.peakHp), hpOn: r3(on.peakHp) };
      R.rec(`r3:${k}`, row);
      const drop = -pct(row.spoolOn, row.spoolOff);
      expect(drop).toBeGreaterThanOrEqual(5);
      expect(drop).toBeLessThanOrEqual(20);
      expect(Math.abs(pct(on.peakHp, off.peakHp))).toBeLessThanOrEqual(4);
    });
  }
});

describe('Rule 4: intercooler', () => {
  for (const k of ['turboI4', 'turboI6'] as const) {
    const pair = () => {
      const b = mutate(base(k), (c) => (c.turbo.targetBoostBar = 1.0));
      const no = sim(mutate(b, (c) => (c.turbo.intercoolerEffectiveness = 0)));
      const yes = sim(mutate(b, (c) => (c.turbo.intercoolerEffectiveness = 0.75)));
      return { no, yes, dT: atPeakPower(yes, 'chargeTempC') - atPeakPower(no, 'chargeTempC') };
    };
    it(`${k} @1 bar: IC 0 → 0.75 = +8–15% power, knock retard not higher`, () => {
      const { no, yes, dT } = pair();
      const row = { gainPct: r3(pct(yes.peakHp, no.peakHp)), dTchargeC: r3(dT), t2C: r3(atPeakPower(no, 'chargeTempC')), retNo: r3(maxRetard(no)), retYes: r3(maxRetard(yes)) };
      R.rec(`r4:${k}`, row);
      expect(row.gainPct).toBeGreaterThanOrEqual(8);
      expect(row.gainPct).toBeLessThanOrEqual(15);
      expect(maxRetard(yes)).toBeLessThanOrEqual(maxRetard(no) + 0.1);
    });
    // The doc's −30…−50 °C band is inconsistent with ε = 0.75 at 1 bar: an η_c≈0.7 compressor
    // at PR≈2 delivers ≈ +90 K over ambient, so ε·ΔT ≈ −65…−70 K. Kept as a documented
    // doc-vs-physics conflict (expected to fail), plus the physics-consistent check below.
    it.fails(`${k} @1 bar: charge temp −30…−50 °C (doc band; physically inconsistent — expected to fail)`, () => {
      const { dT } = pair();
      expect(dT).toBeLessThanOrEqual(-30);
      expect(dT).toBeGreaterThanOrEqual(-50);
    });
    it(`${k} @1 bar: charge-temp drop = ε·(T_comp − T_amb) (physics-consistent, ±15%)`, () => {
      const { no, dT } = pair();
      const expected = -0.75 * (atPeakPower(no, 'chargeTempC') - 25);
      R.rec(`r4:${k}:dTexpected`, r3(expected));
      expect(Math.abs(dT - expected)).toBeLessThanOrEqual(0.15 * Math.abs(expected));
      // compressor outlet at ~PR 2 should be 80–120 °C at 25 °C ambient (η_c 0.65–0.75)
      expect(atPeakPower(no, 'chargeTempC')).toBeGreaterThanOrEqual(80);
      expect(atPeakPower(no, 'chargeTempC')).toBeLessThanOrEqual(125);
    });
  }
});

describe('Rule 5: supercharger types', () => {
  const b = base('scV8');
  const withType = (t: EngineConfig['supercharger']['type'], bar = 0.8) =>
    sim(mutate(b, (c) => ((c.supercharger.type = t), (c.supercharger.targetBoostBar = bar))));
  it('PD (roots/twin-screw): near-flat boost — boost at 40% redline ≥ 75% of redline boost', () => {
    for (const t of ['roots', 'twin-screw'] as const) {
      const r = withType(t);
      const lo = at(r, 0.4 * b.redlineRpm, 'boostBar');
      const hi = r.curve[r.curve.length - 1].boostBar;
      R.rec(`r5:${t}:boostRatio`, r3(lo / hi));
      expect(lo / hi).toBeGreaterThanOrEqual(0.75);
    }
  });
  it('centrifugal: boost ∝ rpm² (at 50% redline ≈ 25% of redline boost, 0.15–0.35)', () => {
    const r = withType('centrifugal');
    const ratio = at(r, 0.5 * b.redlineRpm, 'boostBar') / r.curve[r.curve.length - 1].boostBar;
    R.rec('r5:centrifugal:ratio50', r3(ratio));
    expect(ratio).toBeGreaterThanOrEqual(0.15);
    expect(ratio).toBeLessThanOrEqual(0.35);
  });
  it('equal redline boost: centrifugal makes less mid-range torque than PD', () => {
    const cf = withType('centrifugal');
    const ts = withType('twin-screw');
    const mid = 0.55 * b.redlineRpm;
    R.rec('r5:midTorque', { centrifugal: r3(at(cf, mid)), twinScrew: r3(at(ts, mid)) });
    expect(at(cf, mid)).toBeLessThan(at(ts, mid) * 0.9);
  });
  it('drive loss ≈ 10–15% of gross power at peak (accepted 7–20%) and grows with boost', () => {
    // Drive MEP = FMEP − PMEP − mechanical FMEP; mechanical part estimated from the same engine NA.
    const na = sim(mutate(b, (c) => (c.induction = 'na')));
    const frac = (bar: number) => {
      const r = withType('twin-screw', bar);
      const p = r.curve.find((d) => d.rpm === r.peakPowerRpm)!;
      const q = na.curve.reduce((a, d) => (Math.abs(d.rpm - p.rpm) < Math.abs(a.rpm - p.rpm) ? d : a));
      const mechNa = q.fmepBar - (q.pmepBar ?? 0);
      // Peak-pressure term (0.004·Δpmax) of Chen–Flynn grows with boost; subtract that too.
      const mechSc = mechNa + 0.004 * (p.peakCylinderPressureBar - q.peakCylinderPressureBar);
      const drive = p.fmepBar - (p.pmepBar ?? 0) - mechSc;
      return drive / (p.bmepBar + drive);
    };
    const f08 = frac(0.8);
    const f04 = frac(0.4);
    R.rec('r5:driveFrac', { at0_4: r3(f04), at0_8: r3(f08) });
    expect(f08).toBeGreaterThanOrEqual(0.07);
    expect(f08).toBeLessThanOrEqual(0.2);
    expect(f08).toBeGreaterThan(f04);
  });
});

describe('Rule 6: NA never reports boost', () => {
  it('all NA presets/refs: MAP ≤ 1.013 bar, boost 0, even with tuned runners+headers', () => {
    const bad: string[] = [];
    for (const c of PRESETS.filter((p) => p.induction === 'na')) {
      for (const tweak of [{}, { intakeRunnerMm: 450, exhaust: 'tuned-equal' as const, itb: true }]) {
        const r = sim({ ...c, ...tweak });
        for (const p of r.curve) if (p.mapBar > 1.01325 + 1e-9 || p.boostBar > 0) bad.push(`${c.name} ${p.rpm}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ─────────────────────────────── 7–13 Breathing ───────────────────────────────
describe('Rule 7: intake runner length', () => {
  for (const k of ['naI4', 'naPushrodV8'] as const) {
    it(`${k}: longer runner → lower peak-torque rpm, bounded (200→400 mm moves peak 5–30%)`, () => {
      const b = base(k);
      const rows = [150, 200, 250, 300, 350, 400, 500].map((L) => {
        const r = sim(mutate(b, (c) => (c.intakeRunnerMm = L)));
        return { L, tqRpm: r.peakTorqueRpm, tq: r3(r.peakTorqueNm), hp: r3(r.peakHp) };
      });
      R.rec(`r7:${k}`, rows);
      const r200 = rows.find((x) => x.L === 200)!.tqRpm;
      const r400 = rows.find((x) => x.L === 400)!.tqRpm;
      expect(r400).toBeLessThan(r200);
      const shift = -pct(r400, r200);
      expect(shift).toBeLessThanOrEqual(30);
      // Should be (weakly) monotonic: no reversal larger than one grid step.
      for (let i = 1; i < rows.length; i++) expect(rows[i].tqRpm).toBeLessThanOrEqual(rows[i - 1].tqRpm + 260);
    });
  }
});

describe('Rule 8: cam duration', () => {
  it('LS3 (2v pushrod): +20° @.050 → power peak +800–1000 rpm (accept 500–1400), 2000-rpm torque −5…−10% (accept −3…−14%), peak hp up', () => {
    const b = mutate(base('naPushrodV8'), (c) => (c.redlineRpm = 7500)); // room for the peak to move
    const stock = sim(b);
    const big = sim(mutate(b, (c) => ((c.cam.intakeDurationDeg += 20), (c.cam.exhaustDurationDeg += 20))));
    const row = {
      pkRpmStock: stock.peakPowerRpm, pkRpmBig: big.peakPowerRpm,
      hpStock: r3(stock.peakHp), hpBig: r3(big.peakHp),
      tq2000Pct: r3(pct(at(big, 2000), at(stock, 2000))),
      tqRpmStock: stock.peakTorqueRpm, tqRpmBig: big.peakTorqueRpm,
      floatStock: Math.round(stock.valveFloatRpm), floatBig: Math.round(big.valveFloatRpm),
    };
    R.rec('r8:ls3', row);
    const shift = big.peakPowerRpm - stock.peakPowerRpm;
    expect(shift).toBeGreaterThanOrEqual(500);
    expect(shift).toBeLessThanOrEqual(1400);
    expect(row.tq2000Pct).toBeLessThanOrEqual(-3);
    expect(row.tq2000Pct).toBeGreaterThanOrEqual(-14);
    expect(big.peakHp).toBeGreaterThan(stock.peakHp);
  });
  for (const k of ['naI4', 'naPushrodV8', 'turboI6'] as const) {
    it(`${k}: duration sweep −20…+40° moves torque & power peaks up, low-rpm torque down`, () => {
      const b = mutate(base(k), (c) => (c.redlineRpm += 2000));
      const rows = [-20, 0, 20, 40].map((d) => {
        const r = sim(mutate(b, (c) => ((c.cam.intakeDurationDeg += d), (c.cam.exhaustDurationDeg += d))));
        return { d, pkRpm: r.peakPowerRpm, tqRpm: r.peakTorqueRpm, hp: r3(r.peakHp), tq2500: r3(at(r, 2500)) };
      });
      R.rec(`r8:${k}:sweep`, rows);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].pkRpm, `power-peak rpm at +${rows[i].d}`).toBeGreaterThanOrEqual(rows[i - 1].pkRpm);
        expect(rows[i].tq2500, `2500-rpm torque at +${rows[i].d}`).toBeLessThanOrEqual(rows[i - 1].tq2500 * 1.005);
      }
      // NA only: a turbo's torque peak is set by spool/boost control, not the cam.
      if (b.induction === 'na') expect(rows[3].tqRpm).toBeGreaterThan(rows[0].tqRpm);
    });
  }
});

describe('Rule 9: lobe separation / overlap', () => {
  it('LS3 with long-tubes: LSA 116 → 106 lowers 2000-rpm VE and raises VE at peak-power rpm', () => {
    const b = mutate(base('naPushrodV8'), (c) => ((c.exhaust = 'long-tube'), (c.headerPrimaryMm = 800)));
    const wide = sim(mutate(b, (c) => (c.cam.lobeSeparationDeg = 116)));
    const tight = sim(mutate(b, (c) => (c.cam.lobeSeparationDeg = 106)));
    const rpmHi = wide.peakPowerRpm;
    const row = {
      ve2000Wide: r3(at(wide, 2000, 'volumetricEfficiency')), ve2000Tight: r3(at(tight, 2000, 'volumetricEfficiency')),
      veHiWide: r3(at(wide, rpmHi, 'volumetricEfficiency')), veHiTight: r3(at(tight, rpmHi, 'volumetricEfficiency')),
    };
    R.rec('r9:ls3', row);
    expect(row.ve2000Tight).toBeLessThan(row.ve2000Wide);
    expect(row.veHiTight).toBeGreaterThan(row.veHiWide);
  });
  it('overlap hurts more under turbo back pressure: high-rpm VE benefit of LSA 116→106 smaller on 2JZ than on NA', () => {
    const naB = mutate(base('naI4'), (c) => ((c.cam.vvt = false), (c.cam.variableLift = false)));
    const tB = base('turboI6');
    const gain = (b: EngineConfig) => {
      const w = sim(mutate(b, (c) => (c.cam.lobeSeparationDeg = 116)));
      const t = sim(mutate(b, (c) => (c.cam.lobeSeparationDeg = 106)));
      const rpm = w.peakPowerRpm;
      return { hi: pct(at(t, rpm, 'volumetricEfficiency'), at(w, rpm, 'volumetricEfficiency')), lo: pct(at(t, 2500, 'volumetricEfficiency'), at(w, 2500, 'volumetricEfficiency')) };
    };
    const na = gain(naB);
    const tu = gain(tB);
    R.rec('r9:naVsTurbo', { na: { hi: r3(na.hi), lo: r3(na.lo) }, turbo: { hi: r3(tu.hi), lo: r3(tu.lo) } });
    expect(tu.hi).toBeLessThan(na.hi);
  });
});

describe('Rule 10: valve size', () => {
  for (const k of ['naI4', 'naPushrodV8'] as const) {
    it(`${k}: bigger intake valve (×1.1 vs ×0.85) raises power-peak rpm and peak hp`, () => {
      const b = mutate(base(k), (c) => (c.redlineRpm += 1500));
      const small = sim(mutate(b, (c) => (c.intakeValveMm *= 0.85)));
      const big = sim(mutate(b, (c) => (c.intakeValveMm *= 1.1)));
      R.rec(`r10:${k}`, { rpmSmall: small.peakPowerRpm, rpmBig: big.peakPowerRpm, hpSmall: r3(small.peakHp), hpBig: r3(big.peakHp) });
      expect(big.peakPowerRpm).toBeGreaterThan(small.peakPowerRpm);
      expect(big.peakHp).toBeGreaterThan(small.peakHp);
    });
  }
  it('undersized valves: power peaks where Taylor Z ≈ 0.55–0.6 (accept 0.45–0.70)', () => {
    const zs: Record<string, number> = {};
    for (const k of ['naI4', 'naPushrodV8'] as const) {
      const b = mutate(base(k), (c) => ((c.intakeValveMm *= 0.7), (c.redlineRpm += 3000), (c.cam.vvt = false), (c.cam.variableLift = false)));
      const r = sim(b);
      const s = sanitize(b);
      const g = computeGeometry(s);
      const z = inletMachIndex(g, s, camCandidates(s)[0], (2 * g.stroke * r.peakPowerRpm) / 60, 301);
      zs[k] = r3(z);
    }
    R.rec('r10:zAtPeak', zs);
    for (const z of Object.values(zs)) {
      expect(z).toBeGreaterThanOrEqual(0.45);
      expect(z).toBeLessThanOrEqual(0.7);
    }
  });
});

describe('Rule 11: VVT and variable lift', () => {
  for (const k of ['naI4', 'naPushrodV8'] as const) {
    it(`${k}: VVT raises torque-curve area 3–8% (accept 1.5–12%), peak torque within ±5%`, () => {
      const b = mutate(base(k), (c) => (c.cam.variableLift = false));
      const off = sim(mutate(b, (c) => (c.cam.vvt = false)));
      const on = sim(mutate(b, (c) => (c.cam.vvt = true)));
      const lo = Math.max(1500, b.idleRpm + 500);
      const area = pct(torqueArea(on, lo, b.redlineRpm), torqueArea(off, lo, b.redlineRpm));
      const pk = pct(on.peakTorqueNm, off.peakTorqueNm);
      R.rec(`r11:${k}:vvt`, { areaPct: r3(area), peakTqPct: r3(pk) });
      expect(area).toBeGreaterThanOrEqual(1.5);
      expect(area).toBeLessThanOrEqual(12);
      expect(Math.abs(pk)).toBeLessThanOrEqual(5);
    });
  }
  it('K20: variable lift ≥ either fixed cam at 3000 rpm torque and at peak power', () => {
    const b = mutate(base('naI4'), (c) => (c.cam.vvt = false));
    const vl = sim(mutate(b, (c) => (c.cam.variableLift = true)));
    const high = sim(mutate(b, (c) => (c.cam.variableLift = false)));
    const low = sim(
      mutate(b, (c) => {
        c.cam.variableLift = false;
        c.cam.intakeDurationDeg -= 45;
        c.cam.exhaustDurationDeg -= 30;
        c.cam.intakeLiftMm *= 0.65;
        c.cam.exhaustLiftMm *= 0.75;
      }),
    );
    const row = { vl3000: r3(at(vl, 3000)), hi3000: r3(at(high, 3000)), lo3000: r3(at(low, 3000)), vlHp: r3(vl.peakHp), hiHp: r3(high.peakHp), loHp: r3(low.peakHp) };
    R.rec('r11:vtec', row);
    expect(at(vl, 3000)).toBeGreaterThanOrEqual(Math.max(at(high, 3000), at(low, 3000)) * 0.995);
    expect(vl.peakHp).toBeGreaterThanOrEqual(Math.max(high.peakHp, low.peakHp) * 0.995);
    expect(at(vl, 3000)).toBeGreaterThan(at(high, 3000) * 1.01);
  });
});

describe('Rule 12: exhaust ranking', () => {
  const types = ['log', 'shorty', 'long-tube', 'tuned-equal'] as const;
  for (const k of ['naI4', 'naPushrodV8'] as const) {
    it(`${k} NA: VE at peak power — tuned-equal ≈ long-tube > shorty > log; peak hp same order`, () => {
      const b = mutate(base(k), (c) => (c.headerPrimaryMm = Math.max(c.headerPrimaryMm, 700)));
      const rs = Object.fromEntries(types.map((t) => [t, sim(mutate(b, (c) => (c.exhaust = t)))])) as Record<(typeof types)[number], SimResult>;
      const ve = Object.fromEntries(types.map((t) => [t, atPeakPower(rs[t], 'volumetricEfficiency')])) as Record<string, number>;
      const hp = Object.fromEntries(types.map((t) => [t, rs[t].peakHp])) as Record<string, number>;
      R.rec(`r12:${k}`, { ve: Object.fromEntries(Object.entries(ve).map(([a, v]) => [a, r3(v)])), hp: Object.fromEntries(Object.entries(hp).map(([a, v]) => [a, r3(v)])) });
      expect(hp.shorty).toBeGreaterThan(hp.log);
      expect(hp['long-tube']).toBeGreaterThan(hp.shorty);
      expect(hp['tuned-equal']).toBeGreaterThanOrEqual(hp['long-tube'] * 0.99);
      expect(ve.shorty).toBeGreaterThan(ve.log);
      expect(ve['long-tube']).toBeGreaterThan(ve.shorty);
    });
  }
  it('turbo: exhaust spread smaller than NA; log manifold spools no later than tuned-equal', () => {
    const spread = (b: EngineConfig) => {
      const hs = types.map((t) => sim(mutate(b, (c) => (c.exhaust = t))).peakHp);
      return (Math.max(...hs) - Math.min(...hs)) / Math.min(...hs);
    };
    const na = spread(base('naI4'));
    const tu = spread(base('turboI6'));
    const b = mutate(base('turboI6'), (c) => (c.turbo.compressorInducerMm *= 1.2));
    const sLog = spoolRpm(sim(mutate(b, (c) => (c.exhaust = 'log'))), b.turbo.targetBoostBar);
    const sTuned = spoolRpm(sim(mutate(b, (c) => (c.exhaust = 'tuned-equal'))), b.turbo.targetBoostBar);
    R.rec('r12:turbo', { naSpread: r3(na), turboSpread: r3(tu), spoolLog: sLog, spoolTuned: sTuned });
    expect(tu).toBeLessThan(na);
    expect(sLog).toBeLessThanOrEqual(sTuned);
  });
});

describe('Rule 13: ITB/short runner, throttle restriction', () => {
  it('K20: ITB + 150 mm runners beats plenum + 300 mm at the top end (peak hp)', () => {
    const b = base('naI4');
    const plenum = sim(mutate(b, (c) => ((c.itb = false), (c.intakeRunnerMm = 300))));
    const itb = sim(mutate(b, (c) => ((c.itb = true), (c.intakeRunnerMm = 150))));
    R.rec('r13:itb', { plenum: r3(plenum.peakHp), itb: r3(itb.peakHp), plenumRpm: plenum.peakPowerRpm, itbRpm: itb.peakPowerRpm });
    expect(itb.peakHp).toBeGreaterThan(plenum.peakHp);
  });
  for (const k of ['naI4', 'naPushrodV8'] as const) {
    it(`${k}: throttle below 0.4·√(ΣA_intake valve) cuts peak power; bigger never hurts`, () => {
      const b = base(k);
      const nI = b.valvesPerCylinder === 2 ? 1 : b.valvesPerCylinder === 5 ? 3 : 2;
      const area = b.cylinders * nI * (Math.PI / 4) * b.intakeValveMm ** 2;
      const dCrit = 0.4 * Math.sqrt(area);
      const h = (d: number) => sim(mutate(b, (c) => (c.throttleMm = d))).peakHp;
      const row = { dCrit: r3(dCrit), hp06: r3(h(0.6 * dCrit)), hp1: r3(h(dCrit)), hp15: r3(h(1.5 * dCrit)), hp25: r3(h(2.5 * dCrit)) };
      R.rec(`r13:${k}:throttle`, row);
      expect(row.hp06).toBeLessThan(row.hp15 * 0.92);
      expect(row.hp1).toBeLessThan(row.hp15);
      expect(row.hp25).toBeGreaterThanOrEqual(row.hp15);
    });
  }
});

// ─────────────────────────────── 14–20 Combustion ───────────────────────────────
describe('Rule 14: compression ratio', () => {
  it('K20 on race100 (no knock): +1 CR (10→11) = +2–3% torque (accept 1–4.5%)', () => {
    const b = mutate(base('naI4'), (c) => (c.fuel = 'race100'));
    const r10 = sim(mutate(b, (c) => (c.compressionRatio = 10)));
    const r11 = sim(mutate(b, (c) => (c.compressionRatio = 11)));
    const g = pct(r11.peakTorqueNm, r10.peakTorqueNm);
    R.rec('r14:crGain', { gainPct: r3(g), ret10: r3(maxRetard(r10)), ret11: r3(maxRetard(r11)) });
    expect(g).toBeGreaterThanOrEqual(1);
    expect(g).toBeLessThanOrEqual(4.5);
  });
  it('LS3 on race100: +1 CR (10→11) = +1–4.5% torque', () => {
    const b = mutate(base('naPushrodV8'), (c) => (c.fuel = 'race100'));
    const g = pct(sim(mutate(b, (c) => (c.compressionRatio = 11))).peakTorqueNm, sim(mutate(b, (c) => (c.compressionRatio = 10))).peakTorqueNm);
    R.rec('r14:crGainLs3', r3(g));
    expect(g).toBeGreaterThanOrEqual(1);
    expect(g).toBeLessThanOrEqual(4.5);
  });
  it('NA PFI on 87 at CR 13: substantial knock retard (> 6°)', () => {
    const res: Record<string, number> = {};
    for (const k of ['naI4', 'naPushrodV8'] as const) {
      const r = sim(mutate(base(k), (c) => ((c.fuel = 'gas87'), (c.compressionRatio = 13), (c.directInjection = false))));
      res[k] = r3(maxRetard(r));
    }
    R.rec('r14:cr13gas87', res);
    for (const v of Object.values(res)) expect(v).toBeGreaterThan(6);
  });
  it('beyond the knock limit net torque falls: on 87 the CR sweep 9→16 has an interior optimum', () => {
    for (const k of ['naI4', 'naPushrodV8'] as const) {
      const rows = [9, 10, 11, 12, 13, 14, 15, 16].map((cr) => {
        const r = sim(mutate(base(k), (c) => ((c.fuel = 'gas87'), (c.compressionRatio = cr))));
        return { cr, tq: r3(r.peakTorqueNm), ret: r3(maxRetard(r)) };
      });
      R.rec(`r14:${k}:crSweep87`, rows);
      const best = rows.reduce((a, b) => (b.tq > a.tq ? b : a));
      expect(best.cr).toBeLessThan(16);
      expect(rows[rows.length - 1].tq).toBeLessThan(best.tq * 0.99);
    }
  });
});

describe('Rule 15: higher octane never reduces power', () => {
  const fuels = ['gas87', 'gas91', 'gas93', 'race100'] as const;
  for (const k of Object.keys(BASES) as (keyof typeof BASES)[]) {
    it(`${k}: peak hp non-decreasing 87 → 91 → 93 → 100`, () => {
      const hp = fuels.map((f) => sim(mutate(base(k), (c) => (c.fuel = f))).peakHp);
      R.rec(`r15:${k}`, hp.map(r3));
      for (let i = 1; i < hp.length; i++) expect(hp[i]).toBeGreaterThanOrEqual(hp[i - 1] * 0.999);
    });
  }
  it('LS3 at CR 10.7: 91 → 93 changes peak hp by < 1.5%', () => {
    const b = base('naPushrodV8');
    const d = pct(sim(mutate(b, (c) => (c.fuel = 'gas93'))).peakHp, sim(b).peakHp);
    R.rec('r15:ls3_91to93', r3(d));
    expect(Math.abs(d)).toBeLessThan(1.5);
  });
});

describe('Rule 16: alcohol fuels', () => {
  it('NA (K20) at MBT: E85 +3–5% (accept +1…+8%), BSFC ×1.3–1.5', () => {
    const b = base('naI4');
    const g = sim(b);
    const e = sim(mutate(b, (c) => (c.fuel = 'e85')));
    const row = { hpPct: r3(pct(e.peakHp, g.peakHp)), bsfcRatio: r3(atPeakPower(e, 'bsfcGkWh') / atPeakPower(g, 'bsfcGkWh')), retGas: r3(maxRetard(g)) };
    R.rec('r16:k20e85', row);
    expect(row.hpPct).toBeGreaterThanOrEqual(1);
    expect(row.hpPct).toBeLessThanOrEqual(8);
    expect(row.bsfcRatio).toBeGreaterThanOrEqual(1.3);
    expect(row.bsfcRatio).toBeLessThanOrEqual(1.5);
  });
  it('methanol beats E85 (NA) and BSFC ≈ 2.2× gasoline (accept 1.9–2.5)', () => {
    const b = base('naI4');
    const g = sim(b);
    const e = sim(mutate(b, (c) => (c.fuel = 'e85')));
    const m = sim(mutate(b, (c) => (c.fuel = 'methanol')));
    const ratio = atPeakPower(m, 'bsfcGkWh') / atPeakPower(g, 'bsfcGkWh');
    R.rec('r16:methanol', { hpM: r3(m.peakHp), hpE: r3(e.peakHp), bsfcRatio: r3(ratio) });
    expect(m.peakHp).toBeGreaterThan(e.peakHp);
    expect(ratio).toBeGreaterThanOrEqual(1.9);
    expect(ratio).toBeLessThanOrEqual(2.5);
  });
  it('knock-limited turbo (EA888 @1.6 bar on 91): E85 gives clearly more power (> +5%)', () => {
    const b = mutate(base('turboI4'), (c) => ((c.turbo.targetBoostBar = 1.6), (c.turbo.compressorInducerMm = 52)));
    const g = sim(b);
    const e = sim(mutate(b, (c) => (c.fuel = 'e85')));
    R.rec('r16:turboE85', { hpPct: r3(pct(e.peakHp, g.peakHp)), retGas: r3(maxRetard(g)), retE85: r3(maxRetard(e)) });
    expect(maxRetard(g)).toBeGreaterThan(1);
    expect(pct(e.peakHp, g.peakHp)).toBeGreaterThan(5);
  });
});

describe('Rule 17: direct injection', () => {
  it('knock-limited configs: DI retards less than PFI', () => {
    const cases = {
      k20cr13gas91: mutate(base('naI4'), (c) => ((c.compressionRatio = 13), (c.fuel = 'gas91'))),
      ea888boost16: mutate(base('turboI4'), (c) => ((c.turbo.targetBoostBar = 1.6), (c.turbo.compressorInducerMm = 52))),
    };
    const out: Record<string, unknown> = {};
    for (const [n, b] of Object.entries(cases)) {
      const pfi = sim(mutate(b, (c) => (c.directInjection = false)));
      const di = sim(mutate(b, (c) => (c.directInjection = true)));
      out[n] = { pfi: r3(maxRetard(pfi)), di: r3(maxRetard(di)) };
      expect(maxRetard(pfi)).toBeGreaterThan(0.5);
      expect(maxRetard(di)).toBeLessThan(maxRetard(pfi));
    }
    R.rec('r17:retard', out);
  });
  it('NA K20 and LS3: DI gives +1–3% VE (accept +0.5…+4%) at peak torque rpm', () => {
    const out: Record<string, number> = {};
    for (const k of ['naI4', 'naPushrodV8'] as const) {
      const b = base(k);
      const pfi = sim(mutate(b, (c) => (c.directInjection = false)));
      const di = sim(mutate(b, (c) => (c.directInjection = true)));
      out[k] = r3(pct(at(di, pfi.peakTorqueRpm, 'volumetricEfficiency'), at(pfi, pfi.peakTorqueRpm, 'volumetricEfficiency')));
    }
    R.rec('r17:ve', out);
    for (const v of Object.values(out)) {
      expect(v).toBeGreaterThanOrEqual(0.5);
      expect(v).toBeLessThanOrEqual(4);
    }
  });
});

describe('Rule 18: lambda', () => {
  const lams = [0.7, 0.75, 0.8, 0.84, 0.87, 0.9, 0.94, 1.0, 1.05];
  for (const k of ['naI4', 'naPushrodV8'] as const) {
    it(`${k}: best torque at λ 0.85–0.90; lean of 1 loses; λ<0.75 loses & BSFC up; richer → cooler EGT`, () => {
      const rows = lams.map((l) => {
        const r = sim(mutate(base(k), (c) => (c.lambda = l)));
        return { l, tq: r.peakTorqueNm, bsfc: atPeakPower(r, 'bsfcGkWh'), egt: atPeakPower(r, 'egtC'), ret: maxRetard(r) };
      });
      R.rec(`r18:${k}`, rows.map((x) => ({ l: x.l, tq: r3(x.tq), bsfc: r3(x.bsfc), egt: r3(x.egt), ret: r3(x.ret) })));
      const best = rows.reduce((a, b) => (b.tq > a.tq ? b : a));
      expect(best.l).toBeGreaterThanOrEqual(0.84);
      expect(best.l).toBeLessThanOrEqual(0.9);
      const g = (l: number) => rows.find((x) => x.l === l)!;
      expect(g(1.05).tq).toBeLessThan(g(1.0).tq);
      expect(g(1.0).tq).toBeLessThan(best.tq);
      expect(g(0.7).tq).toBeLessThan(g(0.87).tq);
      expect(g(0.7).bsfc).toBeGreaterThan(g(0.87).bsfc);
      for (const [a, b2] of [[0.75, 0.8], [0.8, 0.87], [0.87, 0.94], [0.94, 1.0]] as const) expect(g(a).egt).toBeLessThan(g(b2).egt);
    });
  }
});

describe('Rule 19: bigger bore (fixed CR & fuel) → more knock', () => {
  it('K20 on 87 at CR 12: bore 80 → 92 mm raises knock retard', () => {
    const b = mutate(base('naI4'), (c) => ((c.fuel = 'gas87'), (c.compressionRatio = 12)));
    const s = sim(mutate(b, (c) => (c.boreMm = 80)));
    const l = sim(mutate(b, (c) => (c.boreMm = 92)));
    R.rec('r19:k20', { ret80: r3(maxRetard(s)), ret92: r3(maxRetard(l)) });
    expect(maxRetard(l)).toBeGreaterThan(maxRetard(s) + 0.5);
  });
  it('EA888 @1.5 bar: bore 78 → 88 mm raises knock retard', () => {
    const b = mutate(base('turboI4'), (c) => ((c.turbo.targetBoostBar = 1.5), (c.turbo.compressorInducerMm = 52)));
    const s = sim(mutate(b, (c) => (c.boreMm = 78)));
    const l = sim(mutate(b, (c) => (c.boreMm = 88)));
    R.rec('r19:ea888', { ret78: r3(maxRetard(s)), ret88: r3(maxRetard(l)) });
    expect(maxRetard(l)).toBeGreaterThan(maxRetard(s) + 0.5);
  });
});

describe('Rule 20: charge temperature', () => {
  for (const k of ['turboI4', 'turboI6'] as const) {
    it(`${k} (knock-limited): ≈ −1% power per +3 °C charge (accept −0.15…−0.6 %/°C), more retard when hotter`, () => {
      const b = mutate(base(k), (c) => ((c.turbo.targetBoostBar = 1.4), (c.turbo.compressorInducerMm *= 1.25)));
      const cool = sim(mutate(b, (c) => (c.turbo.intercoolerEffectiveness = 0.8)));
      const hot = sim(mutate(b, (c) => (c.turbo.intercoolerEffectiveness = 0.5)));
      const dT = atPeakPower(hot, 'chargeTempC') - atPeakPower(cool, 'chargeTempC');
      const slope = pct(hot.peakHp, cool.peakHp) / dT;
      R.rec(`r20:${k}`, { dT: r3(dT), slopePctPerC: r3(slope), retCool: r3(maxRetard(cool)), retHot: r3(maxRetard(hot)) });
      expect(dT).toBeGreaterThan(5);
      expect(slope).toBeLessThanOrEqual(-0.15);
      expect(slope).toBeGreaterThanOrEqual(-0.6);
      expect(maxRetard(hot)).toBeGreaterThanOrEqual(maxRetard(cool));
    });
  }
});

// ─────────────────────────────── 21–25 Mechanical ───────────────────────────────
describe('Rule 21: mean piston speed thresholds', () => {
  const atSp = (sp: number) => {
    const b = base('naI4');
    return sim(mutate(b, (c) => (c.redlineRpm = Math.round((sp * 60) / (2 * (c.strokeMm / 1000))))));
  };
  it('Sp 23.5 m/s → no piston-speed warn/critical', () => {
    expect(hasCode(atSp(23.5), 'piston-speed')).toBe(false);
  });
  it('Sp 26 m/s → piston-speed warn, not critical', () => {
    const r = atSp(26);
    R.rec('r21:sp26', r.warnings.filter((w) => w.code === 'piston-speed'));
    expect(hasCode(r, 'piston-speed', ['warn'])).toBe(true);
    expect(hasCode(r, 'piston-speed', ['critical'])).toBe(false);
  });
  it('Sp 28 m/s → piston-speed critical', () => {
    expect(hasCode(atSp(28), 'piston-speed', ['critical'])).toBe(true);
  });
  it('longer stroke at fixed rpm → higher Sp and lower reliability', () => {
    const b = base('naI4');
    const s = sim(mutate(b, (c) => (c.strokeMm = 80)));
    const l = sim(mutate(b, (c) => (c.strokeMm = 96)));
    R.rec('r21:stroke', { sp80: r3(s.meanPistonSpeedRedlineMs), sp96: r3(l.meanPistonSpeedRedlineMs), rel80: s.reliabilityScore, rel96: l.reliabilityScore });
    expect(l.meanPistonSpeedRedlineMs).toBeGreaterThan(s.meanPistonSpeedRedlineMs);
    expect(l.reliabilityScore).toBeLessThan(s.reliabilityScore);
  });
});

describe('Rule 22: piston acceleration', () => {
  it('max accel = rω²(1 + r/l) within 2% for all references', () => {
    for (const e of REFERENCE_ENGINES) {
      const r = sim(e.config);
      const rr = e.config.strokeMm / 2000;
      const w = (e.config.redlineRpm * 2 * Math.PI) / 60;
      const f = rr * w * w * (1 + rr / (e.config.rodLengthMm / 1000));
      expect(Math.abs(pct(r.maxPistonAccelRedline, f)), e.id).toBeLessThanOrEqual(2);
    }
  });
  it('longer rod lowers it', () => {
    const b = base('naI4');
    expect(sim(mutate(b, (c) => (c.rodLengthMm = 160))).maxPistonAccelRedline).toBeLessThan(sim(mutate(b, (c) => (c.rodLengthMm = 130))).maxPistonAccelRedline);
  });
  it('cast pistons + cast rods above ~40 km/s² must warn', () => {
    const b = mutate(base('naPushrodV8'), (c) => ((c.pistons = 'cast'), (c.rods = 'cast'), (c.crank = 'cast')));
    // pick a redline for ~45 km/s²
    const rr = b.strokeMm / 2000;
    const k = rr * (1 + rr / (b.rodLengthMm / 1000));
    const rpm = Math.round((Math.sqrt(45000 / k) * 60) / (2 * Math.PI));
    const r = sim(mutate(b, (c) => (c.redlineRpm = rpm)));
    R.rec('r22:cast45k', { rpm, accel: r3(r.maxPistonAccelRedline), mechLimit: Math.round(r.mechanicalLimitRpm), warnings: r.warnings.map((w) => `${w.severity}:${w.code}`) });
    expect(hasCode(r, 'rotating-assembly')).toBe(true);
  });
});

describe('Rule 23: valve float', () => {
  for (const k of ['naI4', 'naPushrodV8'] as const) {
    it(`${k}: redline above float rpm adds no power, power falls past float, valve-float warning`, () => {
      const b = base(k);
      const vf = sim(b).valveFloatRpm;
      const at1 = sim(mutate(b, (c) => (c.redlineRpm = Math.round(vf * 0.98))));
      const over = sim(mutate(b, (c) => (c.redlineRpm = Math.round(vf * 1.3))));
      const beyond = over.curve.filter((p) => p.rpm > vf * 1.1);
      R.rec(`r23:${k}`, { vf: Math.round(vf), hpAt: r3(at1.peakHp), hpOver: r3(over.peakHp), pkRpmOver: over.peakPowerRpm, warn: hasCode(over, 'valve-float') });
      expect(over.peakHp).toBeLessThanOrEqual(at1.peakHp * 1.01);
      expect(beyond.length).toBeGreaterThan(0);
      for (const p of beyond) expect(p.powerKw).toBeLessThan(over.peakPowerKw);
      expect(hasCode(over, 'valve-float')).toBe(true);
    });
  }
});

describe('Rule 24: friction and mechanical efficiency', () => {
  it('mechanical FMEP (FMEP − PMEP) rises with rpm on every reference', () => {
    const bad: string[] = [];
    for (const e of REFERENCE_ENGINES) {
      const c = sim(e.config).curve;
      for (let i = 1; i < c.length; i++) {
        const a = c[i - 1].fmepBar - (c[i - 1].pmepBar ?? 0);
        const b2 = c[i].fmepBar - (c[i].pmepBar ?? 0);
        if (c[i].rpm > 2000 && b2 < a - 0.01) bad.push(`${e.id} ${c[i].rpm}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('NA refs: η_m 0.80–0.90 at peak torque, 0.72–0.85 at peak power, ≥ ~0.68 at 9000+ (±0.02)', () => {
    const rows: Record<string, unknown>[] = [];
    const bad: string[] = [];
    for (const e of REFERENCE_ENGINES.filter((x) => x.config.induction === 'na')) {
      const r = sim(e.config);
      const em = (p: { bmepBar: number; imepBar: number }) => p.bmepBar / p.imepBar;
      const t = r.curve.find((p) => p.rpm === r.peakTorqueRpm)!;
      const p = r.curve.find((d) => d.rpm === r.peakPowerRpm)!;
      const row = { id: e.id, atTq: r3(em(t)), atPk: r3(em(p)), pkRpm: r.peakPowerRpm };
      rows.push(row);
      if (row.atTq < 0.78 || row.atTq > 0.92) bad.push(`${e.id} η_m@Tpk ${row.atTq}`);
      const loPk = r.peakPowerRpm >= 9000 ? 0.66 : 0.7;
      if (row.atPk < loPk || row.atPk > 0.87) bad.push(`${e.id} η_m@Ppk ${row.atPk}`);
    }
    R.rec('r24:etaM', rows);
    expect(bad).toEqual([]);
  });
});

describe('Rule 25: mass and cylinder count', () => {
  it('iron block heavier than aluminum', () => {
    for (const k of ['naI4', 'naPushrodV8'] as const) {
      const b = base(k);
      expect(sim(mutate(b, (c) => (c.blockMaterial = 'iron'))).massKg).toBeGreaterThan(sim(mutate(b, (c) => (c.blockMaterial = 'aluminum'))).massKg);
    }
  });
  it('same 3.0 L: I4 → I6 → V8 (same B/S) → more mass, higher mech. limit, lower Sp at fixed rpm', () => {
    const mk = (layout: EngineConfig['layout'], n: number) => {
      const vc = 3000 / n; // cc
      const bore = Math.cbrt((4 * vc * 1000) / Math.PI); // B/S = 1, mm
      return sim(
        mutate(base('naI4'), (c) => {
          c.layout = layout;
          c.cylinders = n;
          c.vAngleDeg = layout === 'v' ? 90 : 0;
          c.boreMm = bore;
          c.strokeMm = bore;
          c.rodLengthMm = 1.62 * bore;
          c.intakeValveMm = 0.407 * bore;
          c.exhaustValveMm = 0.349 * bore;
          c.redlineRpm = 7000;
        }),
      );
    };
    const rs = [mk('inline', 4), mk('inline', 6), mk('v', 8)];
    R.rec('r25:cyl', rs.map((r) => ({ n: r.config.cylinders, mass: r3(r.massKg), mech: Math.round(r.mechanicalLimitRpm), sp: r3(r.meanPistonSpeedRedlineMs) })));
    for (let i = 1; i < rs.length; i++) {
      expect(rs[i].massKg).toBeGreaterThan(rs[i - 1].massKg);
      expect(rs[i].mechanicalLimitRpm).toBeGreaterThan(rs[i - 1].mechanicalLimitRpm);
      expect(rs[i].meanPistonSpeedRedlineMs).toBeLessThan(rs[i - 1].meanPistonSpeedRedlineMs);
    }
  });
});

// Keep `ref` import used for ad-hoc debugging.
void ref;
