/**
 * TEMPORARY STUB — the physics agent replaces this with the real model.
 * Keeps the signature: simulate(config) => SimResult.
 */
import type { EngineConfig, SimResult, DynoPoint } from './types';
import { computeLayout } from './layout';

export function simulate(config: EngineConfig): SimResult {
  const cylCc = (Math.PI / 4) * (config.boreMm / 10) ** 2 * (config.strokeMm / 10);
  const dispCc = cylCc * config.cylinders;
  const curve: DynoPoint[] = [];
  for (let rpm = 1000; rpm <= config.redlineRpm; rpm += 250) {
    const x = rpm / config.redlineRpm;
    const bmep = 12.5 * (1 - 0.9 * (x - 0.65) ** 2);
    const torqueNm = (bmep * 1e5 * dispCc * 1e-6) / (4 * Math.PI);
    const powerKw = (torqueNm * rpm * 2 * Math.PI) / 60 / 1000;
    const sp = (2 * config.strokeMm * 1e-3 * rpm) / 60;
    curve.push({
      rpm, torqueNm, powerKw, hp: (powerKw * 1000) / 745.7, torqueLbFt: torqueNm * 0.737562,
      bmepBar: bmep, imepBar: bmep + 1.5, fmepBar: 1.5, volumetricEfficiency: 0.9, mapBar: 1,
      boostBar: 0, airFlowKgS: 0, fuelFlowKgH: 0, bsfcGkWh: 260, thermalEfficiency: 0.32,
      sparkAdvanceDeg: 28, knockRetardDeg: 0, egtC: 850, chargeTempC: 30,
      meanPistonSpeedMs: sp, peakCylinderPressureBar: 70,
    });
  }
  const pk = curve.reduce((a, b) => (b.powerKw > a.powerKw ? b : a));
  const tq = curve.reduce((a, b) => (b.torqueNm > a.torqueNm ? b : a));
  const lay = computeLayout(config);
  return {
    config, curve, displacementCc: dispCc, displacementL: dispCc / 1000, cylinderCc: cylCc,
    boreStrokeRatio: config.boreMm / config.strokeMm, rodStrokeRatio: config.rodLengthMm / config.strokeMm,
    peakPowerKw: pk.powerKw, peakHp: pk.hp, peakPowerRpm: pk.rpm,
    peakTorqueNm: tq.torqueNm, peakTorqueLbFt: tq.torqueLbFt, peakTorqueRpm: tq.rpm,
    specificOutputHpL: pk.hp / (dispCc / 1000),
    meanPistonSpeedRedlineMs: (2 * config.strokeMm * 1e-3 * config.redlineRpm) / 60,
    maxPistonAccelRedline: 0, valveFloatRpm: 9000, mechanicalLimitRpm: 9000,
    massKg: 120, hpPerKg: pk.hp / 120,
    firingOrder: lay.firingOrder.join('-'), evenFiring: lay.evenFiring,
    balance: { primaryForce: 'balanced', primaryCouple: 'balanced', secondaryForce: 'unbalanced', secondaryCouple: 'balanced', summary: 'stub' },
    reliabilityScore: 90, warnings: [],
  };
}
