/**
 * Calibrate panel state: the imported file, the fit job and its pending result.
 * Kept apart from the main store; it reads the build from it and applies a
 * finished calibration through useStore.applyCalibration.
 */
import { create } from 'zustand';
import { oemLimitOptions } from '../sim/customBuild';
import {
  buildCalibration,
  importDyno,
  startFit,
  type DynoImport,
  type FitJob,
  type FitOk,
  type ImportOptions,
} from '../calibrate';
import { useStore } from './store';

export type FitStatus = 'idle' | 'running' | 'done' | 'error';

interface CalibState {
  sourceName: string;
  text: string;
  /** Overrides the user made on top of auto-detection. */
  opts: ImportOptions;
  imported: DynoImport | null;
  fit: FitOk | null;
  status: FitStatus;
  progress: { frac: number; bestRmsPct: number; evals: number };
  error: string | null;

  load: (name: string, text: string) => void;
  setOpts: (patch: ImportOptions) => void;
  clearData: () => void;
  runFit: () => void;
  cancelFit: () => void;
  discardFit: () => void;
  /** Apply the pending fit to the build. */
  applyFit: () => void;
}

let job: FitJob | null = null;

export const useCalib = create<CalibState>()((set, get) => ({
  sourceName: '',
  text: '',
  opts: {},
  imported: null,
  fit: null,
  status: 'idle',
  progress: { frac: 0, bestRmsPct: 0, evals: 0 },
  error: null,

  load: (name, text) => {
    job?.cancel();
    job = null;
    set({ sourceName: name, text, opts: {}, imported: importDyno(text, {}), fit: null, status: 'idle', error: null });
  },
  setOpts: (patch) => {
    const opts = { ...get().opts, ...patch };
    set({ opts, imported: importDyno(get().text, opts), fit: null, status: get().status === 'running' ? 'running' : 'idle', error: null });
  },
  clearData: () => {
    job?.cancel();
    job = null;
    set({ sourceName: '', text: '', opts: {}, imported: null, fit: null, status: 'idle', error: null });
  },
  runFit: () => {
    const { imported } = get();
    if (!imported || !imported.ok || get().status === 'running') return;
    const s = useStore.getState();
    const c = imported.curve;
    set({ status: 'running', fit: null, error: null, progress: { frac: 0, bestRmsPct: 0, evals: 0 } });
    job = startFit(
      { base: s.config, simOpts: oemLimitOptions(s.config, s.basePreset ?? undefined), measured: { rpm: c.rpm, torqueNm: c.torqueNm } },
      (p) => set({ progress: p }),
    );
    const mine = job;
    mine.promise.then((r) => {
      if (job !== mine) return;
      job = null;
      if (r.ok) set({ status: 'done', fit: r, progress: { frac: 1, bestRmsPct: r.rmsAfterPct, evals: r.evals } });
      else if (r.error.code === 'cancelled') set({ status: 'idle' });
      else set({ status: 'error', error: r.error.message });
    });
  },
  cancelFit: () => {
    job?.cancel();
    job = null;
    set({ status: 'idle' });
  },
  discardFit: () => set({ fit: null, status: 'idle' }),
  applyFit: () => {
    const { fit, imported, sourceName } = get();
    if (!fit || !imported || !imported.ok) return;
    const s = useStore.getState();
    const cal = buildCalibration({
      fit,
      base: s.config,
      applyOemLimits: !!oemLimitOptions(s.config, s.basePreset ?? undefined).applyOemLimits,
      sourceName: sourceName || 'pasted data',
      basis: imported.options.basis,
      drivetrainLossPct: imported.options.drivetrainLossPct,
      standard: imported.options.standard,
      measured: { rpm: imported.curve.rpm, torqueNm: imported.curve.torqueNm },
    });
    s.applyCalibration(cal);
    set({ fit: null, status: 'idle' });
  },
}));

/** The measured curve to draw: the imported file, else the one stored in the applied calibration. */
export function measuredForChart(
  imported: DynoImport | null,
  cal: { measured: { rpm: number[]; torqueNm: number[] }; sourceName: string } | null,
): { name: string; rpm: number[]; torqueNm: number[]; powerKw: number[] } | null {
  if (imported && imported.ok) return { name: 'measured', rpm: imported.curve.rpm, torqueNm: imported.curve.torqueNm, powerKw: imported.curve.powerKw };
  if (cal) return { name: cal.sourceName, rpm: cal.measured.rpm, torqueNm: cal.measured.torqueNm, powerKw: cal.measured.torqueNm.map((t, i) => (t * cal.measured.rpm[i]) / 9549.297) };
  return null;
}
