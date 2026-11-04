import { useStore } from './store';

/** Shared crank clock (deg) integrated from rpm, used for tooltips / audio phase. */
export const crankClock = { thetaDeg: 0 };

let clockStarted = false;
export function startCrankClock() {
  if (clockStarted) return;
  clockStarted = true;
  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const s = useStore.getState();
    if (s.running) crankClock.thetaDeg = (crankClock.thetaDeg + s.rpm * 6 * dt) % 720;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const SWEEP_S = 6;
const HOLD_S = 0.45;
const SETTLE_S = 1.4;

let raf = 0;

export function cancelDynoPull() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  const s = useStore.getState();
  if (s.dynoActive) {
    s.setDynoActive(false);
    s.setLoad(0.35);
  }
}

/** Sweep idle → redline over ~6 s at WOT, hold, then settle back to a cruise rpm. */
export function runDynoPull() {
  cancelDynoPull();
  const st = useStore.getState();
  const { idleRpm, redlineRpm } = st.config;
  const start = Math.max(idleRpm, Math.min(2000, redlineRpm * 0.2));
  const settleTo = Math.round(Math.max(idleRpm, redlineRpm * 0.35));
  st.setRunning(true);
  st.setDynoActive(true);
  st.setLoad(1);
  st.setRpm(idleRpm);
  const t0 = performance.now();
  const ease = (x: number) => x * x * (3 - 2 * x);
  const step = (now: number) => {
    const t = (now - t0) / 1000;
    const s = useStore.getState();
    // Pre-roll: blip from idle to the sweep start in 0.4 s.
    const pre = 0.4;
    if (t < pre) {
      s.setRpm(idleRpm + (start - idleRpm) * ease(t / pre));
    } else if (t < pre + SWEEP_S) {
      // Slightly accelerating sweep (inertia dyno feel) — near-linear in time.
      const x = (t - pre) / SWEEP_S;
      const shaped = 0.82 * x + 0.18 * x * x;
      s.setRpm(start + (redlineRpm - start) * shaped);
    } else if (t < pre + SWEEP_S + HOLD_S) {
      s.setRpm(redlineRpm - 40 * Math.abs(Math.sin(t * 40))); // limiter bounce
    } else if (t < pre + SWEEP_S + HOLD_S + SETTLE_S) {
      const x = (t - pre - SWEEP_S - HOLD_S) / SETTLE_S;
      s.setLoad(1 - 0.65 * ease(x));
      s.setRpm(redlineRpm + (settleTo - redlineRpm) * ease(x));
    } else {
      s.setRpm(settleTo);
      s.setLoad(0.35);
      s.setDynoActive(false);
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
