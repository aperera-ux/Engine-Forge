/**
 * Engineering warnings and the reliability score from design margins.
 */
import type { DynoPoint, EngineConfig, SimWarning } from '../types';
import { PISTON_PMAX, ROD_PMAX } from './mechanical';

export interface WarningInputs {
  c: EngineConfig;
  curve: DynoPoint[];
  meanPistonSpeedRedline: number;
  valveFloatRpm: number;
  mechanicalLimitRpm: number;
  surgeRpm: number | null;
  chokeRpm: number | null;
  spoolRpm: number | null;
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

  // Piston speed.
  const sp = w.meanPistonSpeedRedline;
  if (sp > 25) add('critical', 'piston-speed', `Mean piston speed ${r1(sp)} m/s at redline (> 25 m/s): ring flutter and rod/bearing failure risk.`, 25 + 4 * (sp - 25));
  else if (sp > 22) add('warn', 'piston-speed', `Mean piston speed ${r1(sp)} m/s at redline (> 22 m/s): race-engine territory.`, 4 * (sp - 22));
  else if (sp > 20) score -= 1.5 * (sp - 20);

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

  // Knock.
  // Lugging at WOT near idle is always knock-limited; judge the usable band.
  const band = curve.filter((p) => p.rpm >= Math.max(1500, 2 * c.idleRpm));
  const kc = band.length ? band : curve;
  const maxRetard = Math.max(...kc.map((p) => p.knockRetardDeg));
  const knockPt = kc.find((p) => p.knockRetardDeg === maxRetard);
  if (maxRetard > 15) add('critical', 'knock', `Severe knock: ${r1(maxRetard)}° of spark retard needed at ${knockPt?.rpm} rpm. Lower compression/boost or use higher-octane fuel.`, 15 + maxRetard);
  else if (maxRetard > 6) add('warn', 'knock', `Knock-limited: ${r1(maxRetard)}° retard at ${knockPt?.rpm} rpm costs torque and raises EGT.`, maxRetard);
  else if (maxRetard > 0.5) add('info', 'knock', `Mildly knock-limited (${r1(maxRetard)}° retard at ${knockPt?.rpm} rpm).`, 0.5 * maxRetard);

  // Peak cylinder pressure vs components.
  const pmax = Math.max(...curve.map((p) => p.peakCylinderPressureBar));
  const cap = Math.min(PISTON_PMAX[c.pistons], ROD_PMAX[c.rods]);
  const weak = PISTON_PMAX[c.pistons] <= ROD_PMAX[c.rods] ? `${c.pistons} pistons` : `${c.rods} rods`;
  if (pmax > cap) add(pmax > 1.1 * cap ? 'critical' : 'warn', 'cylinder-pressure', `Peak cylinder pressure ${Math.round(pmax)} bar exceeds what ${weak} tolerate (~${cap} bar).`, 10 + 100 * (pmax / cap - 1));
  else if (pmax > 0.9 * cap) score -= 40 * (pmax / cap - 0.9);

  // EGT.
  const egt = Math.max(...curve.map((p) => p.egtC));
  if (egt > 1000) add('critical', 'egt', `Exhaust gas temperature ${Math.round(egt)} °C: turbine/valve damage likely. Richen mixture or reduce retard.`, 15 + 0.1 * (egt - 1000));
  else if (egt > 950) add('warn', 'egt', `Exhaust gas temperature ${Math.round(egt)} °C exceeds 950 °C.`, 5 + 0.2 * (egt - 950));

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
  if (w.chokeRpm !== null) add('warn', 'compressor-choke', `Compressor choked above ~${w.chokeRpm} rpm: boost falls off, charge temperature rises. Use a larger inducer.`, 6);
  if (w.spoolRpm !== null && w.spoolRpm > 0.7 * c.redlineRpm) add('info', 'turbo-lag', `Turbo reaches target boost only at ~${w.spoolRpm} rpm: big turbo for this displacement.`, 0);

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
