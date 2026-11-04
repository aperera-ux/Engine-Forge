/**
 * EngineSoundParams: everything the DSP core needs, derived by a pure function
 * from EngineConfig + computeLayout + SimResult. The result is a plain,
 * structured-clonable object (it is posted to the AudioWorklet).
 *
 * Geometry → acoustics:
 *  - firing phases and banks come straight from computeLayout (no per-layout
 *    special cases in the synth);
 *  - the exhaust is described as a tree of pipes (primaries → collectors →
 *    mid pipe → muffler chamber → tailpipe → outlet). The tree topology follows
 *    the exhaust type and the physical routing (per-bank collectors on V
 *    engines, boxer crossover pipe for unequal-length flat-4 headers, log
 *    manifolds as a chain of junctions);
 *  - cam timing gives seat EVO/EVC/IVO/IVC in cycle degrees (0 = firing TDC);
 *  - the SimResult curve is resampled into small tables (rpm → peak pressure,
 *    MAP, boost, EGT, knock retard, airflow) so the synth can follow the rpm.
 */
import type { EngineConfig, SimResult } from '../sim/types';
import { computeLayout } from '../sim/layout';

export interface CylinderSound {
  number: number;
  bank: 0 | 1;
  /** Crank angle at firing TDC, deg in [0,720). */
  firingPhaseDeg: number;
  /** Index of this cylinder's primary pipe in `pipes`. */
  pipe: number;
  /** Index of this cylinder's exhaust-port node. */
  portNode: number;
}

export interface PipeSpec {
  lenM: number;
  diamM: number;
  /** Node at the upstream end (towards the ports). */
  up: number;
  /** Node at the downstream end (towards the outlets). */
  down: number;
  /** Mean distance from the exhaust port, m (sets the gas temperature). */
  distM: number;
  /** Extra damping 0..1 (absorptive muffler packing). */
  absorb: number;
  kind: 'primary' | 'log' | 'collector' | 'mid' | 'muffler' | 'tail';
}

/**
 * Network nodes. 'port': exhaust valve end of a primary (cylinder source).
 * 'junction': lossless scattering junction of all pipes that touch it.
 * 'turbine': restriction between exactly one upstream and one downstream pipe.
 * 'outlet': open end radiating to the listener.
 */
export interface NodeSpec {
  type: 'port' | 'junction' | 'turbine' | 'outlet';
  /** Cylinder index (0-based) for ports; outlet index for outlets. */
  ref: number;
}

export interface OutletSpec {
  /** −1 = hard left … +1 = hard right. */
  pan: number;
  diamM: number;
}

export interface CurveTable {
  rpm: number[];
  peakPressureBar: number[];
  imepBar: number[];
  mapBar: number[];
  boostBar: number[];
  egtC: number[];
  knockRetardDeg: number[];
  airFlowKgS: number[];
  exhaustPressureBar: number[];
}

export interface EngineSoundParams {
  name: string;
  nCyl: number;
  layout: EngineConfig['layout'];
  cylinders: CylinderSound[];
  pipes: PipeSpec[];
  nodes: NodeSpec[];
  outlets: OutletSpec[];
  /** Geometry, SI units. */
  boreM: number;
  strokeM: number;
  rodM: number;
  compressionRatio: number;
  /** Swept volume of one cylinder, m³. */
  sweptM3: number;
  clearanceM3: number;
  /** Valve events in cycle degrees (0 = firing TDC, 360 = overlap TDC). */
  evoDeg: number;
  evcDeg: number;
  ivoDeg: number;
  ivcDeg: number;
  /** Valve overlap at 0.050" lift, crank deg (can be negative). */
  overlapDeg: number;
  exValveDiamM: number;
  inValveDiamM: number;
  exLiftM: number;
  inLiftM: number;
  /** Valves per cylinder on each side. */
  exValves: number;
  inValves: number;
  valvesPerCyl: number;
  valvetrain: EngineConfig['valvetrain'];
  vvt: boolean;

  runnerLenM: number;
  runnerDiamM: number;
  plenumM3: number;
  throttleDiamM: number;
  itb: boolean;

  induction: EngineConfig['induction'];
  turbo: {
    count: number;
    targetBoostBar: number;
    inducerM: number;
    /** Compressor exducer (wheel tip) diameter, m. */
    exducerM: number;
    turbineAR: number;
    twinScroll: boolean;
    fullBlades: number;
    /** Spool-up time constant, s, at full exhaust energy. */
    spoolTauS: number;
  };
  supercharger: {
    type: EngineConfig['supercharger']['type'];
    targetBoostBar: number;
    /** Rotor (or impeller) rpm per crank rpm. */
    driveRatio: number;
    /** Pressure pulses per rotor revolution (lobe-pass order) / blades. */
    lobesPerRev: number;
    /** Gear-mesh teeth per rotor (or input-shaft) revolution, for gear whine. */
    gearTeeth: number;
  };

  fuel: EngineConfig['fuel'];
  lambda: number;
  directInjection: boolean;
  idleRpm: number;
  redlineRpm: number;
  displacementL: number;
  /** 0..1, how "aggressive" the build is: cam overlap, free-flowing exhaust, rich mixture. Drives pops. */
  aggressiveness: number;
  /** 0..1 idle lope from cam overlap (reduced with VVT). */
  lope: number;
  /** Output calibration gain (derived from source strength so engines land in a similar loudness range). */
  gain: number;
  curve: CurveTable;
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const mod = (a: number, m: number) => ((a % m) + m) % m;

/** Small deterministic per-cylinder variation (manufacturing tolerance), −1..1. */
function hashUnit(n: number, salt: number): number {
  let h = (n * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

function resampleCurve(result: SimResult | null, cfg: EngineConfig): CurveTable {
  const t: CurveTable = {
    rpm: [],
    peakPressureBar: [],
    imepBar: [],
    mapBar: [],
    boostBar: [],
    egtC: [],
    knockRetardDeg: [],
    airFlowKgS: [],
    exhaustPressureBar: [],
  };
  const c = result?.curve ?? [];
  if (!c.length) {
    // Rough fallback curve: NA engine, flat-ish torque.
    for (const r of [cfg.idleRpm, (cfg.idleRpm + cfg.redlineRpm) / 2, cfg.redlineRpm]) {
      t.rpm.push(r);
      t.peakPressureBar.push(80);
      t.imepBar.push(12);
      t.mapBar.push(1);
      t.boostBar.push(0);
      t.egtC.push(800);
      t.knockRetardDeg.push(0);
      t.airFlowKgS.push(((cfg.cylinders * 0.5e-3 * r) / 120) * 1.18);
      t.exhaustPressureBar.push(1.1);
    }
    return t;
  }
  for (const p of c) {
    t.rpm.push(p.rpm);
    t.peakPressureBar.push(p.peakCylinderPressureBar || 60);
    t.imepBar.push(p.imepBar || p.bmepBar + 1.5);
    t.mapBar.push(p.mapBar || 1);
    t.boostBar.push(Math.max(0, p.boostBar || 0));
    t.egtC.push(p.egtC || 800);
    t.knockRetardDeg.push(Math.max(0, p.knockRetardDeg || 0));
    t.airFlowKgS.push(Math.max(1e-4, p.airFlowKgS || 0.01));
    t.exhaustPressureBar.push(p.exhaustPressureBar ?? 1.05 + 0.02 * p.mapBar);
  }
  return t;
}

/** Linear table lookup (clamped). */
export function tableAt(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (n === 0) return 0;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + (ys[hi] - ys[lo]) * f;
}

/**
 * Split a collector group of cylinders into two evenly-firing sub-groups
 * (4-2-1 style: partners are ~360° apart within a bank of 4).
 */
/** True when a group of cylinders fires at equal intervals. */
function bankEven(cyls: CylinderSound[]): boolean {
  if (cyls.length < 2) return true;
  const ph = cyls.map((c) => c.firingPhaseDeg).sort((a, b) => a - b);
  const iv = ph.map((p, i) => (i === ph.length - 1 ? 720 - p + ph[0] : ph[i + 1] - p));
  return iv.every((d) => Math.abs(d - 720 / cyls.length) < 1);
}

function splitEven(cyls: CylinderSound[]): [CylinderSound[], CylinderSound[]] {
  const s = [...cyls].sort((a, b) => a.firingPhaseDeg - b.firingPhaseDeg);
  const a: CylinderSound[] = [];
  const b: CylinderSound[] = [];
  s.forEach((c, i) => (i % 2 === 0 ? a : b).push(c));
  return [a, b];
}

export function deriveSoundParams(cfg: EngineConfig, result: SimResult | null): EngineSoundParams {
  const lay = computeLayout(cfg);
  const n = cfg.cylinders;
  const boreM = cfg.boreMm / 1000;
  const strokeM = cfg.strokeMm / 1000;
  const rodM = Math.max(cfg.rodLengthMm, cfg.strokeMm * 1.3) / 1000;
  const sweptM3 = (Math.PI / 4) * boreM * boreM * strokeM;
  const cr = Math.max(6, cfg.compressionRatio);
  const clearanceM3 = sweptM3 / (cr - 1);
  const displacementL = (sweptM3 * n) / 1e-3;

  // ── cam timing (cycle degrees, 0 = firing TDC) ──
  const cam = cfg.cam;
  const icl = cam.intakeCenterlineDeg;
  const ecl = 2 * cam.lobeSeparationDeg - icl;
  const seatPad = 46; // seat-to-seat duration ≈ 0.050" duration + ~46°
  const exSeat = cam.exhaustDurationDeg + seatPad;
  const inSeat = cam.intakeDurationDeg + seatPad;
  const exCenter = 360 - ecl;
  const inCenter = 360 + icl;
  const evoDeg = clamp(exCenter - exSeat / 2, 80, 170);
  const evcDeg = Math.max(evoDeg + 160, exCenter + exSeat / 2);
  const ivoDeg = inCenter - inSeat / 2;
  const ivcDeg = inCenter + inSeat / 2;
  const overlapDeg = cam.intakeDurationDeg / 2 + cam.exhaustDurationDeg / 2 - 2 * cam.lobeSeparationDeg;

  const exValves = cfg.valvesPerCylinder >= 4 ? 2 : cfg.valvesPerCylinder === 5 ? 2 : 1;
  const inValves = cfg.valvesPerCylinder - exValves;

  const cylinders: CylinderSound[] = lay.cylinders.map((c) => ({
    number: c.number,
    bank: c.bank,
    firingPhaseDeg: c.firingPhaseDeg,
    pipe: -1,
    portNode: -1,
  }));

  // ── exhaust topology ──
  const pipes: PipeSpec[] = [];
  const outlets: OutletSpec[] = [];
  const dPrim = clamp(cfg.headerDiameterMm, 18, 90) / 1000;
  const exType = cfg.exhaust;
  const turbo = cfg.induction === 'turbo';
  const turboCount = turbo ? (cfg.turbo.count === 2 ? 2 : 1) : 0;
  const lPrimBase = clamp(cfg.headerPrimaryMm, 60, 1500) / 1000;
  const tol = exType === 'tuned-equal' ? 0.01 : exType === 'long-tube' ? 0.04 : exType === 'shorty' ? 0.12 : 0.05;
  const boreSpacingM = lay.boreSpacingMm / 1000;
  // Engine half-width (crank centre to head face) for boxer crossover routing.
  const deckM = strokeM / 2 + rodM + 0.035;

  const nodes: NodeSpec[] = [];
  const addNode = (type: NodeSpec['type'], ref = -1): number => {
    nodes.push({ type, ref });
    return nodes.length - 1;
  };
  const addPipe = (p: Omit<PipeSpec, 'absorb'> & { absorb?: number }): number => {
    pipes.push({ absorb: 0, ...p });
    return pipes.length - 1;
  };

  // Group cylinders into exhaust systems (one per outlet "side").
  const isV = cfg.layout !== 'inline' && n >= 2;
  const bankA = cylinders.filter((c) => c.bank === 0);
  const bankB = cylinders.filter((c) => c.bank === 1);
  type System = { cyls: CylinderSound[]; pan: number; crossover: Set<number> };
  const systems: System[] = [];
  const mergeBanks = !isV || n <= 2 || (cfg.layout === 'flat' && n <= 4) || (turbo && turboCount === 1 && n <= 6);
  if (mergeBanks) {
    // Boxer / V with a single collector: bank B's primaries must cross under the
    // engine (unequal-length "UEL" headers) unless the headers are equal-length.
    const cross = new Set<number>();
    // Which pipes take the long way follows the EJ-style UEL routing: the long runners
    // belong to alternate cylinders in firing order (research §2.4: 194°/166° arrivals).
    if (isV && n > 2 && exType !== 'tuned-equal') lay.firingOrder.forEach((num, k) => k % 2 === 1 && cross.add(num));
    systems.push({ cyls: cylinders, pan: 0, crossover: cross });
  } else if (exType === 'tuned-equal' && lay.evenFiring && !bankEven(bankA)) {
    // 180° "bundle of snakes" headers: pair cylinders across banks so each
    // collector sees an even pulse train (crossplane V8 with tuned headers).
    const [ga, gb] = splitEven(cylinders);
    systems.push({ cyls: ga, pan: -1, crossover: new Set() });
    systems.push({ cyls: gb, pan: 1, crossover: new Set() });
  } else {
    systems.push({ cyls: bankA, pan: -1, crossover: new Set() });
    systems.push({ cyls: bankB, pan: 1, crossover: new Set() });
  }

  const dTail = clamp(0.04 + 0.017 * Math.sqrt(displacementL / systems.length), 0.045, 0.09);
  const sporty = exType === 'long-tube' || exType === 'tuned-equal' ? 1 : exType === 'shorty' ? 0.5 : 0;

  systems.forEach((sys, si) => {
    const k = sys.cyls.length;
    const dColl = clamp(dPrim * Math.sqrt(Math.min(k, 4)) * 0.85, dPrim, 0.1);
    const collectorLen = exType === 'log' ? 0.15 : 0.3;
    const dualExit = systems.length === 1; // single system → Y-split into two tailpipes for width
    // Downstream chain: collector → [turbine] → mid pipe → muffler → tail(s) → outlet(s).
    const jColl = addNode('junction'); // where primaries / secondaries / log meet the collector
    const jCollOut = addNode(turbo ? 'turbine' : 'junction');
    const jMid = addNode('junction');
    const jMuf = addNode('junction');
    addPipe({ lenM: collectorLen, diamM: dColl, up: jColl, down: jCollOut, distM: 0.6, kind: 'collector' });
    addPipe({ lenM: 1.1 * (1 + 0.08 * si), diamM: dTail, up: jCollOut, down: jMid, distM: 1.4, kind: 'mid' });
    addPipe({ lenM: 0.42, diamM: dTail * (1.4 - 0.15 * sporty), up: jMid, down: jMuf, distM: 2.2, kind: 'muffler', absorb: 0.55 - 0.35 * sporty });
    const nTails = dualExit ? 2 : 1;
    for (let t = 0; t < nTails; t++) {
      const o = outlets.length;
      outlets.push({ pan: dualExit ? (t === 0 ? -0.45 : 0.45) : sys.pan * 0.75, diamM: dualExit ? dTail * 0.8 : dTail });
      const on = addNode('outlet', o);
      addPipe({ lenM: 0.55 * (1 + 0.07 * t + 0.05 * si), diamM: outlets[o].diamM, up: jMuf, down: on, distM: 2.7, kind: 'tail' });
    }

    const primLen = (c: CylinderSound) => {
      const base = exType === 'log' ? Math.min(lPrimBase, 0.12) : lPrimBase;
      const extra = sys.crossover.has(c.number) ? 2 * deckM * 0.9 + 0.12 : 0;
      return base * (1 + tol * hashUnit(c.number, 7)) + extra;
    };
    const addPrimary = (c: CylinderSound, down: number) => {
      c.portNode = addNode('port', c.number - 1);
      const L = primLen(c);
      c.pipe = addPipe({ lenM: L, diamM: dPrim, up: c.portNode, down, distM: L / 2, kind: 'primary' });
    };

    if (exType === 'log' && k > 1) {
      // Log manifold: short stubs join a common log at successive positions along the head.
      const byRow = [...sys.cyls].sort((a, b) => {
        const ra = lay.cylinders[a.number - 1].row;
        const rb = lay.cylinders[b.number - 1].row;
        return ra - rb || a.bank - b.bank;
      });
      // Twin-scroll turbos keep two pulse-separated logs (front / rear half) into the turbine.
      const groups = turbo && cfg.turbo.twinScroll && byRow.length >= 4 ? [byRow.slice(0, byRow.length >> 1), byRow.slice(byRow.length >> 1)] : [byRow];
      for (const grp of groups) {
        let node = addNode('junction');
        addPrimary(grp[0], node);
        for (let j = 1; j < grp.length; j++) {
          const next = j === grp.length - 1 ? jColl : addNode('junction');
          addPipe({ lenM: Math.max(0.05, boreSpacingM), diamM: dColl, up: node, down: next, distM: 0.25, kind: 'log' });
          addPrimary(grp[j], next);
          node = next;
        }
        if (grp.length === 1) addPipe({ lenM: 0.05, diamM: dColl, up: node, down: jColl, distM: 0.25, kind: 'log' });
      }
    } else if (exType === 'tuned-equal' && k >= 4 && k % 2 === 0) {
      // 4-2-1 / tri-Y: two evenly-firing secondaries, then the collector.
      for (const g of splitEven(sys.cyls)) {
        const jSec = addNode('junction');
        addPipe({
          lenM: lPrimBase * 0.75,
          diamM: clamp(dPrim * Math.sqrt(g.length) * 0.82, dPrim, 0.09),
          up: jSec,
          down: jColl,
          distM: lPrimBase + 0.2,
          kind: 'collector',
        });
        for (const c of g) addPrimary(c, jSec);
      }
    } else {
      for (const c of sys.cyls) addPrimary(c, jColl);
    }
  });

  // ── intake ──
  const runnerLenM = clamp(cfg.intakeRunnerMm, 40, 900) / 1000;
  const runnerDiamM = clamp(cfg.intakeValveMm * (cfg.valvesPerCylinder >= 4 ? 1.35 : 0.95), 25, 75) / 1000;
  const plenumM3 = cfg.itb ? 0 : sweptM3 * n * 1.1;

  // ── forced induction ──
  const inducerM = clamp(cfg.turbo.compressorInducerMm, 25, 110) / 1000;
  const exducerM = inducerM / 0.72;
  const spoolTauS = clamp(0.35 * Math.pow(inducerM / 0.05, 2.2) * Math.sqrt(cfg.turbo.turbineAR / 0.7) * (cfg.turbo.twinScroll ? 0.8 : 1), 0.12, 2.5);
  const scType = cfg.supercharger.type;
  const scBoost = Math.max(0, cfg.supercharger.targetBoostBar);
  // Research §5.4: roots/screw rotor at ~90 % of max speed at redline; centrifugal 8–14× crank.
  const driveRatio =
    scType === 'centrifugal'
      ? clamp(9 + 3 * scBoost, 8, 14)
      : clamp((scType === 'roots' ? 16500 : 18000) / Math.max(3000, cfg.redlineRpm), 1.6, 4);
  const lobesPerRev = scType === 'roots' ? 8 : scType === 'twin-screw' ? 4 : 10;
  const gearTeeth = scType === 'centrifugal' ? 4 : scType === 'twin-screw' ? 34 : 30;

  // ── character ──
  const lope = clamp((overlapDeg + 10) / 45, 0, 1) * (cam.vvt ? 0.35 : 1);
  const richness = clamp((0.92 - cfg.lambda) / 0.15, 0, 1);
  const aggressiveness = clamp(0.25 * sporty + 0.35 * clamp((overlapDeg + 15) / 50, 0, 1) + 0.25 * richness + (turbo ? 0.1 : 0) + (cfg.directInjection ? -0.05 : 0.05), 0, 1);

  // Output gain: total radiated source strength scales roughly with the
  // per-cylinder swept volume × firing rate; normalise towards a common level
  // but keep some size dependence (bigger engines are louder).
  const gain = 5.5 / Math.pow(displacementL, 0.3) / Math.pow(n / 4, 0.1);

  return {
    name: cfg.name,
    nCyl: n,
    layout: cfg.layout,
    cylinders,
    pipes,
    nodes,
    outlets,
    boreM,
    strokeM,
    rodM,
    compressionRatio: cr,
    sweptM3,
    clearanceM3,
    evoDeg: mod(evoDeg, 720),
    evcDeg,
    ivoDeg,
    ivcDeg,
    overlapDeg,
    exValveDiamM: cfg.exhaustValveMm / 1000,
    inValveDiamM: cfg.intakeValveMm / 1000,
    exLiftM: cfg.cam.exhaustLiftMm / 1000,
    inLiftM: cfg.cam.intakeLiftMm / 1000,
    exValves,
    inValves: Math.max(1, inValves),
    valvesPerCyl: cfg.valvesPerCylinder,
    valvetrain: cfg.valvetrain,
    vvt: cam.vvt,
    runnerLenM,
    runnerDiamM,
    plenumM3,
    throttleDiamM: cfg.throttleMm / 1000,
    itb: cfg.itb,
    induction: cfg.induction,
    turbo: {
      count: turboCount || 1,
      targetBoostBar: Math.max(0, cfg.turbo.targetBoostBar),
      inducerM,
      exducerM,
      turbineAR: cfg.turbo.turbineAR,
      twinScroll: cfg.turbo.twinScroll,
      fullBlades: 6,
      spoolTauS,
    },
    supercharger: { type: scType, targetBoostBar: scBoost, driveRatio, lobesPerRev, gearTeeth },
    fuel: cfg.fuel,
    lambda: cfg.lambda,
    directInjection: cfg.directInjection,
    idleRpm: cfg.idleRpm,
    redlineRpm: cfg.redlineRpm,
    displacementL,
    aggressiveness,
    lope,
    gain,
    curve: resampleCurve(result, cfg),
  };
}
