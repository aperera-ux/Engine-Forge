/** Vehicle simulation state: debounced re-run on any input change, optimiser jobs, staleness handling. */
import { useEffect } from 'react';
import { create } from 'zustand';
import type { Objective } from '../../vehicle';
import { curveFromSimResult } from '../../vehicle';
import { useStore } from '../store';
import { runVehicleJob } from './client';
import type { OptimizeOutput, RunConditions, SimOutput } from './compute';
import type { VehicleDesign } from './design';

interface VehicleSimState {
  out: SimOutput | null;
  /** True while a (debounced or running) recompute is outstanding. */
  stale: boolean;
  error: string | null;
  opt: OptimizeOutput | null;
  optBusy: boolean;
  optError: string | null;
  /** Wall time of the last optimiser job, ms. */
  runOptimize: (o: { objective: Objective; finalDrive: boolean; gearRatios: boolean }) => Promise<void>;
  clearOpt: () => void;
}

export const useVehicleSim = create<VehicleSimState>()((set) => ({
  out: null,
  stale: true,
  error: null,
  opt: null,
  optBusy: false,
  optError: null,
  clearOpt: () => set({ opt: null, optError: null }),
  runOptimize: async ({ objective, finalDrive, gearRatios }) => {
    const { result, vehicle } = useStore.getState();
    set({ optBusy: true, optError: null, opt: null });
    const res = await runVehicleJob({
      kind: 'optimize',
      spec: vehicle.spec,
      curve: curveFromSimResult(result),
      cond: conditions(vehicle),
      objective,
      finalDrive,
      gearRatios,
    });
    if (res.kind === 'optimize') set({ opt: res, optBusy: false });
    else set({ optBusy: false, optError: res.kind === 'error' ? res.message : 'unexpected response' });
  },
}));

export const conditions = (v: VehicleDesign): RunConditions => ({
  ambient: v.ambient,
  shiftStrategy: v.shiftStrategy,
  shiftRpmFraction: v.shiftRpmFraction,
  rollout: v.rollout,
});

export const DEBOUNCE_MS = 120;

/** Mount once in Vehicle mode: recomputes (debounced, in the worker) whenever the engine result or the design changes. */
export function useVehicleSimDriver() {
  const result = useStore((s) => s.result);
  const vehicle = useStore((s) => s.vehicle);
  useEffect(() => {
    let cancelled = false;
    useVehicleSim.setState({ stale: true });
    const t = window.setTimeout(async () => {
      const res = await runVehicleJob({
        kind: 'sim',
        spec: vehicle.spec,
        curve: curveFromSimResult(result),
        idleRpm: result.config.idleRpm,
        cond: conditions(vehicle),
      });
      if (cancelled) return; // a newer input superseded this run
      if (res.kind === 'sim') useVehicleSim.setState({ out: res, stale: false, error: null });
      else useVehicleSim.setState({ stale: false, error: res.kind === 'error' ? res.message : 'unexpected response' });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [result, vehicle]);
}
