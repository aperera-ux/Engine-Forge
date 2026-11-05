/**
 * "Custom build" detection and OEM-limit policy (physics agent, v4).
 *
 * A stock preset's ECU carries limits copied from the manufacturer's published
 * rating (`ecu.limitSource === 'published-rating'`). Those limits describe the
 * STOCK hardware. The moment any hardware field differs from the preset the
 * build is "custom": the published torque plateau / power band no longer
 * describes it, so by default the limits do not apply and the engine is
 * predicted from hardware alone.
 *
 * Hardware field = every EngineConfig field except `name`, `ecu`, `idleRpm`
 * (identity / ECU tune / idle target). Fuel, lambda, boost target, cams,
 * valves, CR, bore, stroke, redline etc. all count.
 *
 * UI usage:
 *   const opts = oemLimitOptions(config, presetConfig);   // { applyOemLimits }
 *   const r = simulate(config, { ...opts, includeUnlimited: showToggle });
 */
import type { EngineConfig, SimOptions } from './types';

const IGNORED = new Set(['name', 'ecu', 'idleRpm']);

function diff(a: unknown, b: unknown, path: string, out: string[]): void {
  if (a === b) return;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))) out.push(path);
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    for (const k of new Set([...ka, ...kb])) {
      if (!path && IGNORED.has(k)) continue;
      diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k, out);
    }
    return;
  }
  out.push(path);
}

/** Paths of hardware fields that differ between `config` and its stock `base` preset. */
export function hardwareDiff(config: EngineConfig, base: EngineConfig): string[] {
  const out: string[] = [];
  diff(config, base, '', out);
  return out;
}

/** True when any hardware field differs from the base preset. With no base, the build is custom. */
export function isCustomBuild(config: EngineConfig, base?: EngineConfig): boolean {
  return !base || hardwareDiff(config, base).length > 0;
}

/**
 * Should the OEM limits on this config apply? Limits with any source other
 * than 'published-rating' (user / hardware) always apply. Published-rating
 * limits apply only to an unmodified preset.
 */
export function shouldApplyOemLimits(config: EngineConfig, base?: EngineConfig): boolean {
  const e = config.ecu;
  if (!e || (!e.torqueLimitNm && !e.powerLimitKw)) return false;
  if (e.limitSource !== 'published-rating') return true;
  return !isCustomBuild(config, base);
}

/** simulate() options implementing the default policy above. */
export function oemLimitOptions(config: EngineConfig, base?: EngineConfig): SimOptions {
  return { applyOemLimits: shouldApplyOemLimits(config, base) };
}
