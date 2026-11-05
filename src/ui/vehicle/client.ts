/** Runs vehicle jobs in a Web Worker; falls back to the main thread where Worker is unavailable (tests, old browsers). */
import { handleRequest, type VehicleRequest, type VehicleResponse } from './compute';

let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, { resolve: (r: VehicleResponse) => void; req: VehicleRequest }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === 'undefined') return (worker = null);
    const w = new Worker(new URL('./vehicle.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ id: number; res: VehicleResponse }>) => {
      const cb = pending.get(e.data.id);
      pending.delete(e.data.id);
      cb?.resolve(e.data.res);
    };
    w.onerror = () => {
      // Worker died: answer everything in flight on the main thread and stop using it.
      worker = null;
      const inflight = [...pending.values()];
      pending.clear();
      inflight.forEach((p) => p.resolve(handleRequest(p.req)));
    };
    return (worker = w);
  } catch {
    return (worker = null);
  }
}

export function runVehicleJob(req: VehicleRequest): Promise<VehicleResponse> {
  const w = getWorker();
  if (!w) return new Promise((resolve) => setTimeout(() => resolve(handleRequest(req)), 0));
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, { resolve, req });
    w.postMessage({ id, req });
    // Safety net: if the worker never answers, compute here.
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve(handleRequest(req));
      }
    }, 20000);
  });
}
