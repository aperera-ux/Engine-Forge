import type { SimResult } from '../sim/types';
import { engineCode } from './format';
import { fmt } from './units';
import { valveSplit } from './checks';

const FUEL: Record<string, string> = {
  gas87: '87 AKI', gas91: '91 AKI', gas93: '93 AKI', race100: '100+ race', e85: 'E85', methanol: 'Methanol',
};

/** "1,600–4,800" for a plateau, else the single peak rpm. */
function rpmText(range: [number, number] | undefined, rpm: number): string {
  return range && range[1] - range[0] > 1 ? `${fmt(range[0])}–${fmt(range[1])}` : fmt(rpm);
}

/** Plain-text spec sheet suitable for pasting into a forum post / notes. */
export function buildSheet(r: SimResult, shareLink?: string, calNote?: string): string {
  const c = r.config;
  const v = valveSplit(c.valvesPerCylinder);
  const ind =
    c.induction === 'na'
      ? 'Naturally aspirated'
      : c.induction === 'turbo'
        ? `${c.turbo.count === 2 ? 'Twin' : 'Single'} turbo${c.turbo.twinScroll ? ' (twin-scroll)' : ''}, ${fmt(c.turbo.targetBoostBar, 2)} bar / ${fmt(c.turbo.targetBoostBar * 14.5038, 1)} psi, ${fmt(c.turbo.compressorInducerMm)} mm inducer, A/R ${fmt(c.turbo.turbineAR, 2)}, IC ${fmt(c.turbo.intercoolerEffectiveness * 100)}%`
        : `${c.supercharger.type} supercharger, ${fmt(c.supercharger.targetBoostBar, 2)} bar / ${fmt(c.supercharger.targetBoostBar * 14.5038, 1)} psi, IC ${fmt(c.supercharger.intercoolerEffectiveness * 100)}%`;
  const row = (k: string, val: string) => `  ${k.padEnd(18)} ${val}`;
  const warn = r.warnings.filter((w) => w.severity !== 'info');
  const lines = [
    `ENGINE FORGE · BUILD SHEET`,
    `${c.name}`,
    `${'─'.repeat(52)}`,
    `OUTPUT`,
    row('Peak power', `${fmt(r.peakHp)} hp / ${fmt(r.peakPowerKw)} kW @ ${rpmText(r.peakPowerRpmRange, r.peakPowerRpm)} rpm`),
    row('Peak torque', `${fmt(r.peakTorqueLbFt)} lb·ft / ${fmt(r.peakTorqueNm)} N·m @ ${rpmText(r.peakTorqueRpmRange, r.peakTorqueRpm)} rpm`),
    ...(calNote ? [row('Calibration', calNote)] : []),
    row('Specific output', `${fmt(r.specificOutputHpL, 1)} hp/L`),
    row('Mass / power-wt', `${fmt(r.massKg)} kg · ${fmt(r.hpPerKg, 2)} hp/kg`),
    row('Reliability', `${fmt(r.reliabilityScore)}/100`),
    ``,
    `BLOCK`,
    row('Layout', `${engineCode(c)}${c.layout === 'v' ? ` ${fmt(c.vAngleDeg)}°` : ''} · ${fmt(r.displacementL, 2)} L (${fmt(r.displacementCc)} cc)`),
    row('Bore × stroke', `${fmt(c.boreMm, 1)} × ${fmt(c.strokeMm, 1)} mm (B/S ${fmt(r.boreStrokeRatio, 2)})`),
    row('Rod length', `${fmt(c.rodLengthMm, 1)} mm (R/S ${fmt(r.rodStrokeRatio, 2)})`),
    row('Compression', `${fmt(c.compressionRatio, 1)}:1`),
    row('Firing order', `${r.firingOrder} (${r.evenFiring ? 'even' : 'uneven'} fire)`),
    ``,
    `HEADS & CAMS`,
    row('Valvetrain', `${c.valvetrain === 'pushrod' ? 'OHV pushrod' : c.valvetrain.toUpperCase()}, ${c.valvesPerCylinder}V/cyl`),
    row('Valves', `${v.intake}× ${fmt(c.intakeValveMm, 1)} mm in · ${v.exhaust}× ${fmt(c.exhaustValveMm, 1)} mm ex`),
    row('Cam (@.050")', `${fmt(c.cam.intakeDurationDeg)}°/${fmt(c.cam.exhaustDurationDeg)}°, ${fmt(c.cam.intakeLiftMm, 1)}/${fmt(c.cam.exhaustLiftMm, 1)} mm lift`),
    row('LSA / ICL', `${fmt(c.cam.lobeSeparationDeg, 1)}° / ${fmt(c.cam.intakeCenterlineDeg, 1)}° ATDC${c.cam.vvt ? ' · VVT' : ''}${c.cam.variableLift ? ' · var. lift' : ''}`),
    ``,
    `INDUCTION & EXHAUST`,
    row('Induction', ind),
    row('Intake', `${fmt(c.intakeRunnerMm)} mm runners · ${fmt(c.throttleMm)} mm ${c.itb ? 'ITBs (equiv.)' : 'throttle'}`),
    row('Exhaust', `${c.exhaust}, ${fmt(c.headerPrimaryMm)} mm × ${fmt(c.headerDiameterMm, 1)} mm primaries`),
    ``,
    `FUEL, TUNE & BUILD`,
    row('Fuel', `${FUEL[c.fuel] ?? c.fuel}, λ ${fmt(c.lambda, 2)} WOT${c.directInjection ? ', direct injection' : ''}`),
    row('Rev range', `${fmt(c.idleRpm)}–${fmt(c.redlineRpm)} rpm (mech. limit ~${fmt(r.mechanicalLimitRpm)}, float ~${fmt(r.valveFloatRpm)})`),
    row('Piston speed', `${fmt(r.meanPistonSpeedRedlineMs, 1)} m/s mean @ redline`),
    row('Materials', `${c.blockMaterial} block · ${c.pistons} pistons · ${c.rods} rods · ${c.crank} crank`),
  ];
  if (warn.length) {
    lines.push('', 'DIAGNOSTICS');
    warn.forEach((w) => lines.push(`  [${w.severity.toUpperCase()}] ${w.message}`));
  }
  if (shareLink) lines.push('', `Open in Engine Forge: ${shareLink}`);
  return lines.join('\n');
}
