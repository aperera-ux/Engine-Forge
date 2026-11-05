/** Runs the calibration fit off the main thread, with progress messages and soft cancel. */
import { fitCalibration, type FitInput, type FitResult } from './fit';

export type FitRequest = { type: 'fit'; id: number; input: FitInput } | { type: 'cancel'; id: number };
export type FitMessage =
  | { type: 'progress'; id: number; evals: number; frac: number; bestRmsPct: number }
  | { type: 'done'; id: number; result: FitResult };

interface Ctx {
  onmessage: ((e: MessageEvent<FitRequest>) => void) | null;
  postMessage: (m: FitMessage) => void;
}
const ctx = self as unknown as Ctx;
const cancelled = new Set<number>();

ctx.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'cancel') {
    cancelled.add(m.id);
    return;
  }
  const result = await fitCalibration(m.input, {
    onProgress: (p) => ctx.postMessage({ type: 'progress', id: m.id, ...p }),
    isCancelled: () => cancelled.has(m.id),
  });
  cancelled.delete(m.id);
  ctx.postMessage({ type: 'done', id: m.id, result });
};
