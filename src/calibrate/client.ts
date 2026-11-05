/** Runs a calibration fit in a Web Worker (main-thread fallback where Worker is unavailable). */
import { fitCalibration, type FitInput, type FitResult } from './fit';
import type { FitMessage } from './calibrate.worker';

export interface FitProgress {
  evals: number;
  frac: number;
  bestRmsPct: number;
}

export interface FitJob {
  promise: Promise<FitResult>;
  /** Stop the fit. The promise resolves with { ok: false, error.code: 'cancelled' }. */
  cancel: () => void;
}

const CANCELLED: FitResult = { ok: false, error: { code: 'cancelled', message: 'Fit cancelled.' } };

export function startFit(input: FitInput, onProgress?: (p: FitProgress) => void): FitJob {
  let worker: Worker | null = null;
  try {
    if (typeof Worker !== 'undefined') worker = new Worker(new URL('./calibrate.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  let cancelled = false;
  if (!worker) {
    const promise = fitCalibration(input, { onProgress, isCancelled: () => cancelled }).then((r) => (cancelled ? CANCELLED : r));
    return { promise, cancel: () => (cancelled = true) };
  }
  const w = worker;
  let settle: (r: FitResult) => void = () => {};
  const promise = new Promise<FitResult>((resolve) => (settle = resolve));
  w.onmessage = (e: MessageEvent<FitMessage>) => {
    const m = e.data;
    if (m.type === 'progress') onProgress?.({ evals: m.evals, frac: m.frac, bestRmsPct: m.bestRmsPct });
    else {
      w.terminate();
      settle(cancelled ? CANCELLED : m.result);
    }
  };
  w.onerror = (ev) => {
    w.terminate();
    settle({ ok: false, error: { code: 'sim-failed', message: `The calibration worker failed: ${ev.message || 'unknown error'}` } });
  };
  w.postMessage({ type: 'fit', id: 1, input });
  return {
    promise,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      w.terminate(); // hard stop: the sweep is CPU-bound and cannot be interrupted otherwise
      settle(CANCELLED);
    },
  };
}
