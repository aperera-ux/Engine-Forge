import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

describe('module boundary', () => {
  it('src/calibrate reaches the simulator only through its public API', () => {
    const dir = resolve(__dirname, '../../src/calibrate');
    const allowed = new Set(['../sim/engine', '../sim/types', '../sim/customBuild', '../../sim/engine', '../../sim/types']);
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const src = readFileSync(resolve(dir, f), 'utf8');
      for (const m of src.matchAll(/from '(\.\.\/sim\/[^']+)'/g)) expect(allowed.has(m[1]), `${f} imports ${m[1]}`).toBe(true);
      expect(src).not.toMatch(/sim\/model|setBreathingCache|BREATHING_/);
    }
  });
});
