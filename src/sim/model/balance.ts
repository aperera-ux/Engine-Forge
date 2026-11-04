/**
 * Reciprocating balance from the actual crank geometry (layout.ts).
 *
 * Each cylinder's reciprocating force along its axis e^{iβ} is
 *   F₁ ∝ cos φ,   F₂ ∝ (r/l)·cos 2φ,   φ = θ + α − β  (α = pin angle).
 * Written as complex phasors (direction measured from vertical):
 *   F₁ = ½e^{i(θ+α)} + ½e^{i(2β−θ−α)}  → forward part (rotates with the crank,
 *        cancellable by crank counterweights) + backward part (needs a balance shaft).
 *   F₂ = ½e^{i(2θ+2α−β)} + ½e^{i(3β−2θ−2α)} → both at 2ω, never counterweightable.
 * Couples use the same sums weighted by axial position z (about the centre).
 * "balanced" = the residual that crank counterweights cannot remove is ~0.
 */
import type { EngineConfig, SimResult } from '../types';
import type { EngineLayout } from '../layout';

type C = [number, number];
const add = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const cis = (deg: number, k = 1): C => [k * Math.cos((deg * Math.PI) / 180), k * Math.sin((deg * Math.PI) / 180)];
const mag = (a: C) => Math.hypot(a[0], a[1]);

export interface BalanceDetail {
  primaryForceFwd: number;
  primaryForceBwd: number;
  primaryCoupleFwd: number;
  primaryCoupleBwd: number;
  secondaryForce: number;
  secondaryCouple: number;
}

export function balanceVectors(lay: EngineLayout): BalanceDetail {
  const cyl = lay.cylinders;
  const zMean = cyl.reduce((s, c) => s + c.zMm, 0) / cyl.length;
  let f1f: C = [0, 0], f1b: C = [0, 0], m1f: C = [0, 0], m1b: C = [0, 0];
  let f2a: C = [0, 0], f2b: C = [0, 0], m2a: C = [0, 0], m2b: C = [0, 0];
  for (const c of cyl) {
    const a = c.pinAngleDeg;
    const b = c.bankAngleDeg;
    const z = c.zMm - zMean;
    f1f = add(f1f, cis(a));
    f1b = add(f1b, cis(2 * b - a));
    m1f = add(m1f, cis(a, z));
    m1b = add(m1b, cis(2 * b - a, z));
    f2a = add(f2a, cis(2 * a - b));
    f2b = add(f2b, cis(3 * b - 2 * a));
    m2a = add(m2a, cis(2 * a - b, z));
    m2b = add(m2b, cis(3 * b - 2 * a, z));
  }
  return {
    primaryForceFwd: mag(f1f) / 2,
    primaryForceBwd: mag(f1b) / 2,
    primaryCoupleFwd: mag(m1f) / 2,
    primaryCoupleBwd: mag(m1b) / 2,
    secondaryForce: (mag(f2a) + mag(f2b)) / 2,
    secondaryCouple: (mag(m2a) + mag(m2b)) / 2,
  };
}

export function computeBalance(c: EngineConfig, lay: EngineLayout): SimResult['balance'] {
  const d = balanceVectors(lay);
  const n = c.cylinders;
  // Tolerances: forces relative to one cylinder's amplitude; couples relative
  // to one cylinder's amplitude × bore spacing. Small bank-stagger residuals
  // (e.g. boxer offsets) are reported as balanced, as is conventional.
  const fTol = 0.05;
  const mTol = 0.15 * lay.boreSpacingMm;
  // Forward-rotating primary components are cancelled by crank counterweights;
  // single-cylinder engines can only be half-balanced that way.
  const fwdF = n === 1 ? d.primaryForceFwd : 0;
  const primaryForce = d.primaryForceBwd + fwdF > fTol ? 'unbalanced' : 'balanced';
  const primaryCouple = d.primaryCoupleBwd > mTol ? 'unbalanced' : 'balanced';
  const secondaryForce = d.secondaryForce > fTol ? 'unbalanced' : 'balanced';
  const secondaryCouple = d.secondaryCouple > mTol ? 'unbalanced' : 'balanced';

  const parts: string[] = [];
  if (primaryForce === 'unbalanced') parts.push('primary shaking force');
  if (primaryCouple === 'unbalanced') parts.push('primary rocking couple');
  if (secondaryForce === 'unbalanced') parts.push('secondary (2×) shaking force');
  if (secondaryCouple === 'unbalanced') parts.push('secondary (2×) rocking couple');
  const cw =
    d.primaryCoupleFwd > mTol || (d.primaryForceFwd > fTol && n > 1)
      ? ' Rotating primary imbalance is cancelled by crank counterweights.'
      : '';
  const summary =
    parts.length === 0
      ? `Inherently smooth: primary and secondary forces and couples cancel.${cw}`
      : `Unbalanced ${parts.join(', ')}; ${
          parts.some((p) => p.startsWith('primary')) ? 'needs a balance shaft for full smoothness' : 'balance shafts help at high rpm'
        }.${cw}`;
  return { primaryForce, primaryCouple, secondaryForce, secondaryCouple, summary };
}
