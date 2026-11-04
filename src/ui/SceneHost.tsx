import { Component, lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import type { SceneProps } from './sceneTypes';
const PlaceholderScene = lazy(() => import('./PlaceholderScene'));

/**
 * Picks up the render agent's EngineScene automatically once src/render/index.ts
 * exists and exports it; otherwise (or if it throws) uses the local placeholder.
 * import.meta.glob resolves to {} when the file is absent, so this always compiles.
 */
const renderModules = import.meta.glob('../render/index.ts');
const loader = renderModules['../render/index.ts'] as (() => Promise<Record<string, unknown>>) | undefined;

const RealScene = loader
  ? lazy<ComponentType<SceneProps>>(async () => {
      const mod = await loader();
      const Comp = (mod.EngineScene ?? mod.default) as ComponentType<SceneProps> | undefined;
      if (!Comp) return import('./PlaceholderScene');
      return { default: Comp };
    })
  : null;

export const HAS_REAL_SCENE = !!loader;

class Boundary extends Component<{ children: ReactNode; fallback: ReactNode; resetKey: unknown }, { err: Error | null }> {
  state = { err: null as Error | null };
  componentDidUpdate(prev: { resetKey: unknown }) {
    // Retry the real scene after the config changes (a crash may be config-specific).
    if (this.state.err && prev.resetKey !== this.props.resetKey) this.setState({ err: null });
  }
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  componentDidCatch(err: Error) {
    console.warn('[engine-forge] EngineScene crashed, using placeholder', err);
  }
  render() {
    return this.state.err ? this.props.fallback : this.props.children;
  }
}

export function SceneHost(props: SceneProps) {
  const loading = <div className="scene-loading">Loading engine…</div>;
  const placeholder = (
    <Suspense fallback={loading}>
      <PlaceholderScene {...props} />
    </Suspense>
  );
  if (!RealScene) return placeholder;
  return (
    <Boundary fallback={placeholder} resetKey={props.config}>
      <Suspense fallback={loading}>
        <RealScene {...props} />
      </Suspense>
    </Boundary>
  );
}
