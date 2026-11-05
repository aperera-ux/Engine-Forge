/**
 * The calibratable parameters: a short list of quantities that are genuinely
 * uncertain for a user's build, each with a documented physical range.
 *
 * Two kinds, both built on the public simulate() API only:
 *  - hardware shifts applied to the EngineConfig before simulate()
 *    (runner length, cam timing, boost target);
 *  - output corrections applied to the SimResult's own mean-effective-pressure
 *    terms (volumetric-efficiency / flow scale, friction scale, ECU torque cap).
 *
 * The ranges are deliberately narrow. A parameter that needs to leave its range
 * to match the data is reported as "at bound" rather than silently absorbed.
 */
import type { EngineConfig } from '../sim/types';

export type ParamId = 'veScale' | 'fricScale' | 'runnerScale' | 'camShiftDeg' | 'boostScale' | 'torqueCap';

export interface ParamDef {
  id: ParamId;
  label: string;
  /** Unit of the value ('x' = dimensionless multiplier). */
  unit: string;
  nominal: number;
  min: number;
  max: number;
  /** Decimal places for display. */
  decimals: number;
  /** What it represents physically. */
  what: string;
  /** Why the range is what it is. */
  range: string;
  /** Applies to this config at all? */
  applies: (c: EngineConfig) => boolean;
}

const boosted = (c: EngineConfig) => c.induction !== 'na';

export const PARAM_DEFS: Record<ParamId, ParamDef> = {
  veScale: {
    id: 'veScale',
    label: 'Volumetric efficiency / flow scale',
    unit: 'x',
    nominal: 1,
    min: 0.85,
    max: 1.15,
    decimals: 3,
    what: 'Multiplier on the indicated mean effective pressure: trapped-charge differences from port flow, valve Cd, head porting, airbox and combustion efficiency that the model does not see.',
    range: '+/-15 %. The model reproduces published NA peak torque to about 6 to 8 % RMS, and ported heads or restrictive intakes move real engines by 5 to 10 %, so a larger scale is a data or unit problem, not tuning.',
    applies: () => true,
  },
  fricScale: {
    id: 'fricScale',
    label: 'Friction scale',
    unit: 'x',
    nominal: 1,
    min: 0.7,
    max: 1.5,
    decimals: 3,
    what: 'Multiplier on friction mean effective pressure (rings, bearings, valvetrain, pumping, accessories).',
    range: '0.7 to 1.5. Break-in state, oil viscosity and ring tension move motoring friction by about +/-30 % between otherwise identical engines (Chen-Flynn constants differ by that much between engine families).',
    applies: () => true,
  },
  runnerScale: {
    id: 'runnerScale',
    label: 'Intake tuning length scale',
    unit: 'x',
    nominal: 1,
    min: 0.8,
    max: 1.25,
    decimals: 3,
    what: 'Multiplier on the intake runner length: the effective acoustic length (runner + plenum + airbox) that sets the torque-peak rpm. Scaling length by L shifts the tuned rpm by about 1/sqrt(L).',
    range: '0.8 to 1.25 (tuned rpm moves about -11 % to +12 %). Measured or estimated runner lengths are rarely better than +/-20 % once plenum volume is included.',
    applies: () => true,
  },
  camShiftDeg: {
    id: 'camShiftDeg',
    label: 'Cam timing shift',
    unit: 'deg',
    nominal: 0,
    min: -6,
    max: 6,
    decimals: 2,
    what: 'Added to the intake centreline angle (crank degrees): real installed timing, chain stretch and cam-card tolerance against the nominal figure.',
    range: '+/-6 crank degrees. Cam install and tolerance errors are 2 to 4 degrees; deliberate advance/retard tuning is up to about 6.',
    applies: () => true,
  },
  boostScale: {
    id: 'boostScale',
    label: 'Boost target scale',
    unit: 'x',
    nominal: 1,
    min: 0.85,
    max: 1.2,
    decimals: 3,
    what: 'Multiplier on the boost target (turbo or supercharger): actual achieved boost against the nominal spring or tune figure.',
    range: '0.85 to 1.20. Wastegate spring and boost-control tolerance is about +/-10 %; a stage-1 style tune adds up to about 20 %.',
    applies: boosted,
  },
  torqueCap: {
    id: 'torqueCap',
    label: 'ECU torque limit (fraction of peak)',
    unit: 'x',
    nominal: 1,
    min: 0.6,
    max: 1,
    decimals: 3,
    what: 'Brake-torque limit as a fraction of this build\'s hardware peak torque. 1.0 = no limit. Reproduces the flat torque plateaus OEM torque management gives turbo engines.',
    range: '0.6 to 1.0 of hardware peak: OEM torque structures sit 5 to 30 % below what the hardware makes unconstrained; below 60 % the engine would not be the same build.',
    applies: boosted,
  },
};

export const ALL_PARAM_IDS = Object.keys(PARAM_DEFS) as ParamId[];

export type ParamValues = Partial<Record<ParamId, number>>;

/** Parameters that apply to this config, in a fixed order. */
export function activeParams(c: EngineConfig): ParamId[] {
  return ALL_PARAM_IDS.filter((id) => PARAM_DEFS[id].applies(c));
}

export function nominalValues(ids: ParamId[]): ParamValues {
  return Object.fromEntries(ids.map((id) => [id, PARAM_DEFS[id].nominal])) as ParamValues;
}

export function clampParam(id: ParamId, v: number): number {
  const d = PARAM_DEFS[id];
  return Math.min(d.max, Math.max(d.min, v));
}

export function formatParam(id: ParamId, v: number): string {
  const d = PARAM_DEFS[id];
  if (id === 'camShiftDeg') return `${v > 0 ? '+' : ''}${v.toFixed(d.decimals)} deg`;
  if (id === 'torqueCap') return v >= 0.995 ? 'none' : `${(v * 100).toFixed(1)} % of peak`;
  return `x ${v.toFixed(d.decimals)}`;
}
