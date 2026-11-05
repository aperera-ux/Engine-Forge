import { handleRequest, type VehicleRequest, type VehicleResponse } from './compute';

interface Ctx {
  onmessage: ((e: MessageEvent<{ id: number; req: VehicleRequest }>) => void) | null;
  postMessage: (m: { id: number; res: VehicleResponse }) => void;
}
const ctx = self as unknown as Ctx;
ctx.onmessage = (e) => {
  ctx.postMessage({ id: e.data.id, res: handleRequest(e.data.req) });
};
