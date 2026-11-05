import { create } from 'zustand';
import type { EngineConfig, SimResult } from '../sim/types';
import { DEFAULT_CONFIG } from '../sim/defaults';
import { simulate } from '../sim/engine';
import { PRESETS } from '../sim/presets';
import { oemLimitOptions } from '../sim/customBuild';
import { SUPPORTED_CYLINDERS } from '../sim/layout';
import type { Units } from './units';
import { DEFAULT_DESIGN, mergeDesign, type VehicleDesign } from './vehicle/design';

export type AppMode = 'engine' | 'vehicle';

export type ViewMode = 'solid' | 'cutaway' | 'xray';

export interface Snapshot {
  id: string;
  name: string;
  /** Slot index 0..2, stable so the colour follows the snapshot. */
  slot: number;
  result: SimResult;
}

export const MAX_SNAPSHOTS = 3;
/** Saved custom engines ("Garage"): fixed slots that persist in this browser. */
export const GARAGE_SLOTS = 3;
const LS_CONFIG = 'engine-forge:config:v1';
const LS_GARAGE = 'engine-forge:garage:v1';

export interface SavedEngine {
  name: string;
  config: EngineConfig;
  /** epoch ms */
  savedAt: number;
  peakHp: number;
  peakTorqueNm: number;
  displacementL: number;
  /** Vehicle design saved with the build. Absent on saves made before Vehicle mode existed. */
  vehicle?: VehicleDesign;
}
export type GarageSlot = SavedEngine | null;
const LS_PREFS = 'engine-forge:prefs:v1';
const LS_VEHICLE = 'engine-forge:vehicle:v1';

export interface UIState {
  config: EngineConfig;
  /** The stock preset the current build was loaded from (null if none). Used for the custom-build check. */
  basePreset: EngineConfig | null;
  /** Show the hardware-only (no factory ECU limit) curve as a dashed overlay. */
  showUnlimited: boolean;
  setShowUnlimited: (b: boolean) => void;
  result: SimResult;
  simError: string | null;
  simMs: number;
  rpm: number;
  /** 0–1 throttle/load used for render + audio. */
  load: number;
  running: boolean;
  viewMode: ViewMode;
  units: Units;
  appMode: AppMode;
  vehicle: VehicleDesign;
  setAppMode: (m: AppMode) => void;
  /** Replace the whole vehicle design (preset / garage load). */
  loadVehicle: (v: VehicleDesign) => void;
  /** Patch the design; `spec` patches merge into design.spec. */
  setVehicle: (patch: Partial<Omit<VehicleDesign, 'spec'>> & { spec?: Partial<VehicleDesign['spec']> }) => void;
  snapshots: Snapshot[];
  garage: GarageSlot[];
  dynoActive: boolean;
  muted: boolean;
  panelCollapsed: boolean;
  hoveredCylinder: number | null;

  setConfig: (patch: Partial<EngineConfig>) => void;
  setCam: (patch: Partial<EngineConfig['cam']>) => void;
  setTurbo: (patch: Partial<EngineConfig['turbo']>) => void;
  setSupercharger: (patch: Partial<EngineConfig['supercharger']>) => void;
  loadConfig: (cfg: EngineConfig) => void;
  setRpm: (rpm: number) => void;
  setLoad: (load: number) => void;
  setRunning: (running: boolean) => void;
  setViewMode: (m: ViewMode) => void;
  setUnits: (u: Units) => void;
  addSnapshot: (name?: string) => void;
  removeSnapshot: (id: string) => void;
  renameSnapshot: (id: string, name: string) => void;
  /** Save the current engine into a garage slot (overwrites). Returns the slot used. */
  saveToGarage: (slot: number, name?: string) => number;
  loadFromGarage: (slot: number) => void;
  renameGarageSlot: (slot: number, name: string) => void;
  clearGarageSlot: (slot: number) => void;
  setDynoActive: (b: boolean) => void;
  setMuted: (b: boolean) => void;
  togglePanel: () => void;
  setHoveredCylinder: (n: number | null) => void;
}

/** Deep-merge a possibly partial / stale config onto the defaults. */
export function mergeConfig(raw: unknown): EngineConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<EngineConfig>;
  return normalizeConfig({
    ...DEFAULT_CONFIG,
    ...r,
    cam: { ...DEFAULT_CONFIG.cam, ...(r.cam ?? {}) },
    turbo: { ...DEFAULT_CONFIG.turbo, ...(r.turbo ?? {}) },
    supercharger: { ...DEFAULT_CONFIG.supercharger, ...(r.supercharger ?? {}) },
  });
}

function nearest(list: number[], n: number): number {
  return list.reduce((best, c) => (Math.abs(c - n) < Math.abs(best - n) ? c : best), list[0]);
}

/** Keep the config physically consistent (layout ↔ cylinders ↔ V-angle etc). */
export function normalizeConfig(c: EngineConfig): EngineConfig {
  const out = { ...c };
  const allowed = SUPPORTED_CYLINDERS[out.layout] ?? SUPPORTED_CYLINDERS.inline;
  if (!allowed.includes(out.cylinders)) out.cylinders = nearest(allowed, out.cylinders);
  if (out.layout === 'flat') out.vAngleDeg = 180;
  else if (out.layout === 'v' && (out.vAngleDeg >= 180 || out.vAngleDeg < 15)) out.vAngleDeg = 90;
  if (out.idleRpm >= out.redlineRpm - 1000) out.idleRpm = Math.max(500, out.redlineRpm - 1000);
  if (out.rodLengthMm < out.strokeMm * 1.3) out.rodLengthMm = Math.round(out.strokeMm * 1.3);
  if (out.valvetrain === 'pushrod' && out.valvesPerCylinder > 3) out.valvesPerCylinder = 2;
  return out;
}

/** Stock preset with this name, if any (the build's reference for the custom-build check). */
export function presetByName(name: string): EngineConfig | null {
  return PRESETS.find((p) => p.name === name) ?? null;
}

function runSim(config: EngineConfig, base: EngineConfig | null, wantUnlimited: boolean, prev?: SimResult): { result: SimResult; simError: string | null; simMs: number } {
  const t0 = performance.now();
  try {
    const opts = oemLimitOptions(config, base ?? undefined);
    // The hardware-only curve costs a 2nd solve (~2x on turbo presets, measured ~25 ms vs ~12 ms), so it is
    // only requested while the overlay toggle is on AND a limit is actually in force.
    const result = simulate(config, { ...opts, includeUnlimited: wantUnlimited && !!opts.applyOemLimits });
    if (!result || !Array.isArray(result.curve) || result.curve.length === 0) throw new Error('empty curve');
    return { result, simError: null, simMs: performance.now() - t0 };
  } catch (e) {
    console.warn('[engine-forge] simulate failed', e);
    const msg = e instanceof Error ? e.message : String(e);
    if (prev) return { result: prev, simError: msg, simMs: performance.now() - t0 };
    throw e;
  }
}

// ---- URL hash share ---------------------------------------------------------
function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): string {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '==='.slice((pad.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}
export function configToHash(cfg: EngineConfig): string {
  return `#cfg=${b64urlEncode(JSON.stringify(cfg))}`;
}
export function shareUrl(cfg: EngineConfig): string {
  return `${location.origin}${location.pathname}${configToHash(cfg)}`;
}
function configFromHash(): EngineConfig | null {
  const m = /[#&]cfg=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (!m) return null;
  try {
    return mergeConfig(JSON.parse(b64urlDecode(m[1])));
  } catch {
    return null;
  }
}

/** Validate one garage entry from storage. Old saves have no `vehicle`; that stays undefined. */
export function parseSavedEngine(e: unknown): SavedEngine | null {
  if (!e || typeof e !== 'object' || !(e as SavedEngine).config) return null;
  const r = e as Record<string, unknown>;
  const config = mergeConfig(r.config);
  const out: SavedEngine = {
    name: typeof r.name === 'string' && r.name.trim() ? r.name : config.name,
    config,
    savedAt: Number(r.savedAt) || Date.now(),
    peakHp: Number(r.peakHp) || 0,
    peakTorqueNm: Number(r.peakTorqueNm) || 0,
    displacementL: Number(r.displacementL) || 0,
  };
  if (r.vehicle && typeof r.vehicle === 'object') out.vehicle = mergeDesign(r.vehicle);
  return out;
}

function initialGarage(): GarageSlot[] {
  const empty: GarageSlot[] = Array.from({ length: GARAGE_SLOTS }, () => null);
  if (typeof window === 'undefined') return empty;
  try {
    const raw = JSON.parse(localStorage.getItem(LS_GARAGE) ?? 'null');
    if (!Array.isArray(raw)) return empty;
    return empty.map((_, i) => parseSavedEngine(raw[i]));
  } catch {
    return empty;
  }
}

function initialVehicle(): VehicleDesign {
  if (typeof window === 'undefined') return DEFAULT_DESIGN;
  try {
    const raw = localStorage.getItem(LS_VEHICLE);
    if (raw) return mergeDesign(JSON.parse(raw));
  } catch {
    /* ignore */
  }
  return DEFAULT_DESIGN;
}

function initialConfig(): EngineConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  const fromHash = configFromHash();
  if (fromHash) return fromHash;
  try {
    const raw = localStorage.getItem(LS_CONFIG);
    if (raw) return mergeConfig(JSON.parse(raw));
  } catch {
    /* ignore */
  }
  return DEFAULT_CONFIG;
}

function initialPrefs(): { units: Units; viewMode: ViewMode; panelCollapsed: boolean; appMode: AppMode } {
  try {
    const p = JSON.parse(localStorage.getItem(LS_PREFS) ?? '{}');
    return {
      units: p.units === 'imperial' ? 'imperial' : 'metric',
      viewMode: ['solid', 'cutaway', 'xray'].includes(p.viewMode) ? p.viewMode : 'solid',
      panelCollapsed: !!p.panelCollapsed,
      appMode: p.appMode === 'vehicle' ? 'vehicle' : 'engine',
    };
  } catch {
    return { units: 'metric', viewMode: 'solid', panelCollapsed: false, appMode: 'engine' };
  }
}

const cfg0 = initialConfig();
const base0 = presetByName(cfg0.name);
const sim0 = runSim(cfg0, base0, false);
const prefs0 = initialPrefs();

let snapCounter = 0;

export const useStore = create<UIState>()((set, get) => {
  const apply = (config: EngineConfig, base: EngineConfig | null = get().basePreset) => {
    const norm = normalizeConfig(config);
    const r = runSim(norm, base, get().showUnlimited, get().result);
    const rpm = Math.min(Math.max(get().rpm, norm.idleRpm), norm.redlineRpm);
    set({ config: norm, basePreset: base, ...r, rpm });
  };
  return {
    config: cfg0,
    basePreset: base0,
    showUnlimited: false,
    setShowUnlimited: (showUnlimited) => {
      set({ showUnlimited });
      if (showUnlimited) apply(get().config); // re-solve once with the hardware-only curve
    },
    ...sim0,
    rpm: Math.round(Math.max(cfg0.idleRpm, cfg0.redlineRpm * 0.45)),
    load: 0.35,
    running: true,
    viewMode: prefs0.viewMode,
    units: prefs0.units,
    appMode: prefs0.appMode,
    vehicle: initialVehicle(),
    setAppMode: (appMode) => set({ appMode }),
    loadVehicle: (v) => set({ vehicle: mergeDesign(structuredClone(v)) }),
    setVehicle: (patch) => {
      const cur = get().vehicle;
      set({ vehicle: { ...cur, ...patch, spec: { ...cur.spec, ...(patch.spec ?? {}) } } });
    },
    snapshots: [],
    garage: initialGarage(),
    dynoActive: false,
    muted: true,
    panelCollapsed: prefs0.panelCollapsed,
    hoveredCylinder: null,

    setConfig: (patch) => apply({ ...get().config, ...patch }),
    setCam: (patch) => apply({ ...get().config, cam: { ...get().config.cam, ...patch } }),
    setTurbo: (patch) => apply({ ...get().config, turbo: { ...get().config.turbo, ...patch } }),
    setSupercharger: (patch) =>
      apply({ ...get().config, supercharger: { ...get().config.supercharger, ...patch } }),
    loadConfig: (cfg) => apply(mergeConfig(structuredClone(cfg)), presetByName(cfg.name)),
    setRpm: (rpm) => {
      const { idleRpm, redlineRpm } = get().config;
      set({ rpm: Math.min(Math.max(rpm, idleRpm), redlineRpm) });
    },
    setLoad: (load) => set({ load: Math.min(1, Math.max(0, load)) }),
    setRunning: (running) => set({ running }),
    setViewMode: (viewMode) => set({ viewMode }),
    setUnits: (units) => set({ units }),
    addSnapshot: (name) => {
      const { snapshots, result, config } = get();
      const used = new Set(snapshots.map((s) => s.slot));
      let slot = [0, 1, 2].find((i) => !used.has(i));
      let next = snapshots;
      if (slot === undefined) {
        // Replace the oldest.
        slot = snapshots[0].slot;
        next = snapshots.slice(1);
      }
      snapCounter += 1;
      const snap: Snapshot = {
        id: `snap-${Date.now()}-${snapCounter}`,
        name: name?.trim() || `${config.name || 'Engine'} #${snapCounter}`,
        slot,
        result,
      };
      set({ snapshots: [...next, snap].slice(-MAX_SNAPSHOTS) });
    },
    saveToGarage: (slot, name) => {
      const { config, result, garage } = get();
      const i = Math.max(0, Math.min(GARAGE_SLOTS - 1, Math.floor(slot)));
      const nm = (name ?? config.name).trim() || `Custom engine ${i + 1}`;
      const saved: SavedEngine = {
        name: nm,
        config: { ...structuredClone(config), name: nm },
        savedAt: Date.now(),
        peakHp: result.peakHp,
        peakTorqueNm: result.peakTorqueNm,
        displacementL: result.displacementL,
        vehicle: structuredClone(get().vehicle),
      };
      const next = garage.slice();
      next[i] = saved;
      // The engine being edited now carries the saved name too.
      set({ garage: next });
      if (config.name !== nm) get().setConfig({ name: nm });
      return i;
    },
    loadFromGarage: (slot) => {
      const e = get().garage[slot];
      if (!e) return;
      get().loadConfig({ ...e.config, name: e.name });
      // Old saves carry no vehicle: keep the current design rather than resetting it.
      if (e.vehicle) get().loadVehicle(e.vehicle);
    },
    renameGarageSlot: (slot, name) => {
      const nm = name.trim();
      const e = get().garage[slot];
      if (!e || !nm) return;
      const next = get().garage.slice();
      next[slot] = { ...e, name: nm, config: { ...e.config, name: nm } };
      set({ garage: next });
    },
    clearGarageSlot: (slot) => {
      const next = get().garage.slice();
      next[slot] = null;
      set({ garage: next });
    },
    removeSnapshot: (id) => set({ snapshots: get().snapshots.filter((s) => s.id !== id) }),
    renameSnapshot: (id, name) =>
      set({ snapshots: get().snapshots.map((s) => (s.id === id ? { ...s, name } : s)) }),
    setDynoActive: (dynoActive) => set({ dynoActive }),
    setMuted: (muted) => set({ muted }),
    togglePanel: () => set({ panelCollapsed: !get().panelCollapsed }),
    setHoveredCylinder: (hoveredCylinder) => set({ hoveredCylinder }),
  };
});

// ---- persistence -------------------------------------------------------------
if (typeof window !== 'undefined') {
  let t: number | undefined;
  let tv: number | undefined;
  useStore.subscribe((s, prev) => {
    if (s.config !== prev.config) {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        try {
          localStorage.setItem(LS_CONFIG, JSON.stringify(s.config));
        } catch {
          /* quota */
        }
        // Keep the URL in sync without polluting history, but only if it is already a share link.
        if (location.hash.includes('cfg=')) history.replaceState(null, '', configToHash(s.config));
      }, 250);
    }
    if (s.garage !== prev.garage) {
      try {
        localStorage.setItem(LS_GARAGE, JSON.stringify(s.garage));
      } catch {
        /* quota */
      }
    }
    if (s.vehicle !== prev.vehicle) {
      window.clearTimeout(tv);
      tv = window.setTimeout(() => {
        try {
          localStorage.setItem(LS_VEHICLE, JSON.stringify(s.vehicle));
        } catch {
          /* quota */
        }
      }, 250);
    }
    if (s.units !== prev.units || s.viewMode !== prev.viewMode || s.panelCollapsed !== prev.panelCollapsed || s.appMode !== prev.appMode) {
      try {
        localStorage.setItem(
          LS_PREFS,
          JSON.stringify({ units: s.units, viewMode: s.viewMode, panelCollapsed: s.panelCollapsed, appMode: s.appMode }),
        );
      } catch {
        /* ignore */
      }
    }
  });
  window.addEventListener('hashchange', () => {
    const c = configFromHash();
    if (c) useStore.getState().loadConfig(c);
  });
}

/** Linear interpolation of a dyno curve quantity at rpm. */
export function curveAt<K extends keyof SimResult['curve'][number]>(
  result: SimResult,
  rpm: number,
  key: K,
): number {
  const c = result.curve;
  if (!c.length) return 0;
  if (rpm <= c[0].rpm) return c[0][key] as number;
  if (rpm >= c[c.length - 1].rpm) return c[c.length - 1][key] as number;
  let lo = 0;
  let hi = c.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (c[mid].rpm <= rpm) lo = mid;
    else hi = mid;
  }
  const a = c[lo];
  const b = c[hi];
  const t = (rpm - a.rpm) / (b.rpm - a.rpm || 1);
  return (a[key] as number) + ((b[key] as number) - (a[key] as number)) * t;
}
