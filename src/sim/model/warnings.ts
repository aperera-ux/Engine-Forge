/**
 * Engineering warnings and the reliability score from design margins.
 */
import type { DynoPoint, EngineConfig, SimWarning } from '../types';
import { PISTON_PMAX, ROD_PMAX } from './mechanical';
import { sparkWorkRatio } from './combustion';

export interface WarningInputs {
  c: EngineConfig;
  curve: DynoPoint[];
  meanPistonSpeedRedline: number;
  valveFloatRpm: number;
  mechanicalLimitRpm: number;
  surgeRpm: number | null;
  chokeRpm: number | null;
  spoolRpm: number | null;
  /** Boost shortfall in the upper rev range: worst achieved/target ratio and why. */
  boostShortfall: { ratio: number; rpm: number; reason: string; reachedAnywhere: boolean } | null;
}

export function computeWarnings(w: WarningInputs): { warnings: SimWarning[]; reliabilityScore: number } {
  const { c, curve } = w;
  const out: SimWarning[] = [];
  let score = 100;
  const add = (severity: SimWarning['severity'], code: string, message: string, penalty: number) => {
    out.push({ severity, code, message });
    score -= penalty;
  };
  const r1 = (x: number) => Math.round(x * 10) / 10;

  // Piston speed. Modern production engines run up to ~25–27 m/s (F20C 25.2,
  // Audi V10 26.9) with forged parts and DLC/FRM bores; beyond that is racing.
  const sp = w.meanPistonSpeedRedline;
  if (sp > 30) add('critical', 'piston-speed', `Mean piston speed ${r1(sp)} m/s at redline (> 30 m/s): ring flutter and rod/bearing failure risk.`, 30 + 4 * (sp - 30));
  else if (sp > 27) add('warn', 'piston-speed', `Mean piston speed ${r1(sp)} m/s at redline (> 27 m/s): beyond production-engine practice.`, 10 + 4 * (sp - 27));
  else if (sp > 22) add('info', 'piston-speed', `High mean piston speed ${r1(sp)} m/s at redline (high-performance territory).`, 1.5 * (sp - 22));
  // Mechanical limit.
  if (w.mechanicalLimitRpm < c.redlineRpm) {
    const over = c.redlineRpm / w.mechanicalLimitRpm - 1;
    add(over > 0.08 ? 'critical' : 'warn', 'rotating-assembly', `Redline exceeds the rotating assembly's safe limit (~${Math.round(w.mechanicalLimitRpm)} rpm). Upgrade rods/pistons/crank.`, 10 + 150 * over);
  } else {
    const margin = w.mechanicalLimitRpm / c.redlineRpm - 1;
    if (margin < 0.05) score -= (0.05 - margin) * 100;
  }

  // Valve float.
  if (w.valveFloatRpm < c.redlineRpm) {
    add(w.valveFloatRpm < 0.95 * c.redlineRpm ? 'critical' : 'warn', 'valve-float', `Valve float predicted at ~${Math.round(w.valveFloatRpm)} rpm, below the ${Math.round(c.redlineRpm)} rpm redline. Use lighter valves, stiffer springs or less lift.`, 12 + 120 * (c.redlineRpm / w.valveFloatRpm - 1));
  }

  // Knock. Retard at lugging speeds is normal ECU behaviour; judge the main
  // band (≥2500 rpm) by average retard and the torque cost at peak power.
  const band = curve.filter((p) => p.rpm >= Math.max(2500, 2 * c.idleRpm));
  const kc = band.length ? band : curve;
  const meanRetard = kc.reduce((s2, p) => s2 + p.knockRetardDeg, 0) / kc.length;
  const maxRetard = Math.max(...kc.map((p) => p.knockRetardDeg));
  const knockPt = kc.find((p) => p.knockRetardDeg === maxRetard);
  const pk = curve.reduce((a2, b2) => (b2.powerKw > a2.powerKw ? b2 : a2));
  const lossAtPeak = 1 - sparkWorkRatio(pk.knockRetardDeg);
  if (meanRetard > 15 || lossAtPeak > 0.12) add('critical', 'knock', `Severe knock: average ${r1(meanRetard)}° spark retard above 2500 rpm (${r1(maxRetard)}° at ${knockPt?.rpm} rpm), costing ${Math.round(100 * lossAtPeak)} % at peak power. Lower compression/boost or use higher-octane fuel.`, 15 + meanRetard);
  else if (meanRetard > 13 || lossAtPeak > 0.09) add('warn', 'knock', `Knock-limited: average ${r1(meanRetard)}° retard above 2500 rpm costs torque and raises EGT.`, 4 + meanRetard / 2);
  else if (maxRetard > 3) add('info', 'knock', `Knock-limited in places (${r1(maxRetard)}° retard at ${knockPt?.rpm} rpm); normal for a pump-fuel calibration.`, 0);

  // Peak cylinder pressure vs components.
  const pmax = Math.max(...curve.map((p) => p.peakCylinderPressureBar));
  const cap = Math.min(PISTON_PMAX[c.pistons], ROD_PMAX[c.rods]);
  const weak = PISTON_PMAX[c.pistons] <= ROD_PMAX[c.rods] ? `${c.pistons} pistons` : `${c.rods} rods`;
  if (pmax > cap) add(pmax > 1.1 * cap ? 'critical' : 'warn', 'cylinder-pressure', `Peak cylinder pressure ${Math.round(pmax)} bar exceeds what ${weak} tolerate (~${cap} bar).`, 10 + 100 * (pmax / cap - 1));
  else if (pmax > 0.9 * cap) score -= 40 * (pmax / cap - 0.9);

  // EGT. Modern turbine housings and exhaust valves are rated ~980–1050 °C.
  const egt = Math.max(...curve.map((p) => p.egtC));
  if (egt > 1050) add('critical', 'egt', `Exhaust gas temperature ${Math.round(egt)} °C: turbine/valve damage likely. Richen mixture or reduce retard.`, 15 + 0.1 * (egt - 1050));
  else if (egt > 1000) add('warn', 'egt', `Exhaust gas temperature ${Math.round(egt)} °C exceeds 1000 °C.`, 5 + 0.2 * (egt - 1000));
  else if (egt > 950) add('info', 'egt', `Exhaust gas temperature ${Math.round(egt)} °C: hot but within modern turbine/valve ratings.`, 0);

  // Lambda under boost.
  const maxBoost = Math.max(...curve.map((p) => p.boostBar));
  if (maxBoost > 0.3 && c.lambda > 0.86) {
    const sev = c.lambda > 0.95 ? 'critical' : 'warn';
    add(sev, 'lean-boost', `Lambda ${c.lambda.toFixed(2)} under ${r1(maxBoost)} bar boost is lean; boosted engines usually run 0.75–0.82.`, sev === 'critical' ? 15 : 6);
  }
  if (c.lambda > 1.05 && maxBoost <= 0.3) add('warn', 'lean', `Lean WOT mixture (lambda ${c.lambda.toFixed(2)}) raises combustion and valve temperatures.`, 5);
  if (c.lambda < 0.75) add('info', 'rich', `Very rich mixture (lambda ${c.lambda.toFixed(2)}) wastes fuel and can wash cylinder walls.`, 2);

  // Compressor.
  if (w.surgeRpm !== null) add('warn', 'compressor-surge', `Compressor surge below ~${w.surgeRpm} rpm: the compressor is too large for the airflow at that pressure ratio.`, 8);
  if (w.chokeRpm !== null) {
    // Choke only in the last few hundred rpm before the limiter is the usual OEM sizing compromise.
    const late = w.chokeRpm >= 0.9 * c.redlineRpm;
    add(late ? 'info' : 'warn', 'compressor-choke', `Compressor choked above ~${w.chokeRpm} rpm: boost falls off, charge temperature rises.${late ? ' (Near the limiter only.)' : ' Use a larger inducer.'}`, late ? 0 : 6);
  }
  if (w.spoolRpm !== null && w.spoolRpm > 0.7 * c.redlineRpm) add('info', 'turbo-lag', `Turbo reaches target boost only at ~${w.spoolRpm} rpm: big turbo for this displacement.`, 0);

  // Boost target not reached.
  const bs = w.boostShortfall;
  if (bs && bs.ratio < 0.95) {
    const why: Record<string, string> = {
      turbine: 'the turbine cannot supply enough power (exhaust energy too low / turbine too large)',
      'speed-line': 'the compressor is at its maximum wheel speed (pressure ratio limit) — use a larger compressor',
      choke: 'the compressor is choking (flow limit) — use a larger inducer',
      'exhaust-pressure': 'turbine-inlet pressure would exceed the limit — use a larger turbine A/R',
      knock: 'knock control trims boost (octane/CR/charge temperature limit)',
      none: 'compressor/turbine limits',
    };
    // Tapering at the top end is normal OEM practice (info); never getting near target is a build problem.
    const sev = !bs.reachedAnywhere ? 'warn' : 'info';
    add(sev, 'boost-target', `Target boost not held: ${Math.round(100 * bs.ratio)} % of target at ${bs.rpm} rpm because ${why[bs.reason] ?? bs.reason}.`, sev === 'warn' ? 4 : 0);
  }

  // No usable output at all (e.g. enormous engine on a tiny throttle/turbo).
  const peakKw = Math.max(...curve.map((p) => p.powerKw));
  if (peakKw < 1) add('critical', 'no-power', 'The engine produces no brake power: pumping and friction losses exceed the indicated work (check throttle size, turbine size and compression).', 50);

  // Geometry.
  const rodRatio = c.rodLengthMm / c.strokeMm;
  if (rodRatio < 1.5) add('warn', 'rod-ratio', `Rod/stroke ratio ${rodRatio.toFixed(2)} < 1.5: high side loads and piston acceleration.`, 6 + 30 * (1.5 - rodRatio));
  const nI = c.valvesPerCylinder === 2 ? 1 : c.valvesPerCylinder === 5 ? 3 : 2;
  const nE = c.valvesPerCylinder >= 4 ? 2 : 1;
  // Valve rows must fit across the bore (2V: intake + exhaust side by side;
  // multi-valve: the intake row and the exhaust row each span the bore).
  const w2 = (c.intakeValveMm + c.exhaustValveMm) / c.boreMm;
  const wMulti = Math.max(nI * c.intakeValveMm * (nI === 3 ? 0.88 : 1), nE * c.exhaustValveMm) / c.boreMm;
  const fitW = c.valvesPerCylinder === 2 ? w2 : wMulti;
  const [warnW, critW] = c.valvesPerCylinder === 2 ? [0.94, 1.0] : [0.87, 0.93];
  if (fitW > critW) {
    add('critical', 'valve-geometry', `Valves do not fit the ${c.boreMm} mm bore (valve diameters too large for the chamber).`, 25);
  } else if (fitW > warnW) {
    add('warn', 'valve-geometry', 'Valves are very large for the bore: shrouding and valve-to-valve clearance problems.', 4);
  }
  if (c.cam.intakeLiftMm / c.intakeValveMm > 0.4) add('info', 'valve-lift', 'Intake lift beyond ~0.35×valve diameter adds little flow but stresses the valvetrain.', 2);
  if (c.compressionRatio > 14 && (c.fuel === 'gas87' || c.fuel === 'gas91')) add('info', 'compression', 'Compression ratio above 14:1 on pump gas relies on heavy knock retard.', 0);

  return { warnings: out, reliabilityScore: Math.max(0, Math.min(100, Math.round(score))) };
}
