/** Visual slow-motion: real rpm is far too fast to read, so the crank is
 * animated at a readable speed that still rises monotonically with rpm. */
export interface VisualSpeed {
  /** Crank revolutions per second actually shown on screen. */
  revPerSec: number;
  /** Slow-motion factor = shown speed / real speed (e.g. 0.02 = 50x slower). */
  factor: number;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * timeScale undefined/<=0 → auto (0.5..3 rev/s mapped from 600..9000 rpm).
 * timeScale > 0 → revPerSec = rpm/60 · timeScale (capped at 40 rev/s).
 */
export function visualSpeed(rpm: number, timeScale?: number): VisualSpeed {
  const real = Math.max(0, rpm) / 60;
  if (real <= 0) return { revPerSec: 0, factor: 0 };
  let rev: number;
  if (timeScale !== undefined && timeScale > 0) rev = Math.min(real * timeScale, 40);
  else {
    const t = clamp((rpm - 600) / 8400, 0, 1);
    rev = 0.5 + 2.5 * Math.pow(t, 0.85);
  }
  return { revPerSec: rev, factor: rev / real };
}
