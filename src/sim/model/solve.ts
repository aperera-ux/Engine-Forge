/**
 * Small numeric helpers shared by the submodels.
 */

/**
 * Root of a monotone function on a bracket [lo, hi] by the Illinois
 * (modified regula falsi) method. Converges super-linearly; `iters` is a
 * hard cap and `relTol` the bracket width (relative to |hi|) at which it stops.
 * Returns the bracket point with the smaller |f| interpolated root.
 * `pure`: f has no side effects, so the final (result-independent) evaluation
 * can be skipped; the returned root is bit-identical either way.
 * `fTol`: also stop at the first evaluated x with |f(x)| ≤ fTol (default 0).
 */
export function illinois(
  f: (x: number) => number,
  lo: number,
  hi: number,
  iters = 30,
  relTol = 1e-7,
  fLo?: number,
  fHi?: number,
  pure = false,
  fTol = 0,
): number {
  let a = lo;
  let b = hi;
  let fa = fLo ?? f(a);
  let fb = fHi ?? f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa * fb > 0) return Math.abs(fa) < Math.abs(fb) ? a : b;
  let side = 0;
  const tol = relTol * Math.max(Math.abs(a), Math.abs(b), 1e-12);
  let x = 0.5 * (a + b);
  for (let i = 0; i < iters; i++) {
    x = (a * fb - b * fa) / (fb - fa);
    if (!(x > Math.min(a, b) && x < Math.max(a, b))) x = 0.5 * (a + b);
    // The returned x does not depend on f(x) once the bracket is within
    // tolerance: for side-effect-free f skip that last evaluation (same result).
    if (pure && Math.abs(b - a) < tol) return x;
    const fx = f(x);
    if (Math.abs(fx) <= fTol || Math.abs(b - a) < tol) return x;
    if (fx * fb > 0) {
      b = x;
      fb = fx;
      if (side === -1) fa /= 2;
      side = -1;
    } else {
      a = x;
      fa = fx;
      if (side === 1) fb /= 2;
      side = 1;
    }
  }
  return x;
}
