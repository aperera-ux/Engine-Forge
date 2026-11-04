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
}
