import type { EngineConfig } from '../sim/types';

/** "I4", "V8", "F6", "VR6"-ish short code. */
export function engineCode(c: EngineConfig): string {
  const p = c.layout === 'inline' ? 'I' : c.layout === 'v' ? 'V' : 'H';
  const crank = c.layout === 'v' && c.cylinders === 8 ? (c.crankPlane === 'flat' ? ' flat-plane' : '') : '';
  return `${p}${c.cylinders}${crank}`;
}
