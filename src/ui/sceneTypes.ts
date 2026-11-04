import type { EngineConfig } from '../sim/types';
import type { ViewMode } from './store';

/** Props contract for the render agent's <EngineScene/> (src/render/index.ts). */
export interface SceneProps {
  config: EngineConfig;
  rpm: number;
  running: boolean;
  viewMode: ViewMode;
  load?: number;
  egtC?: number;
  timeScale?: number;
  onCylinderHover?: (cylinder: number | null) => void;
  quality?: 'high' | 'low';
  /** Shift framed engine by viewport fraction (+x right, +y up). */
  viewOffset?: { x: number; y: number };
  /** Visual crank angle θ (deg, [0,720)), ~15 Hz. */
  onCrankAngle?: (deg: number) => void;
  onFps?: (fps: number) => void;
}
