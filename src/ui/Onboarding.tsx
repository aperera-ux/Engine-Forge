import { useEffect, useState } from 'react';
import { useStore } from './store';

const KEY = 'engine-forge:onboarded:v1';

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1' || localStorage.getItem('engine-forge:config:v1') !== null;
  } catch {
    return true;
  }
}

/** One-time, non-blocking hint card. Goes away on any interaction or after 14 s. */
export function Onboarding() {
  const [show, setShow] = useState(() => !seen());
  useEffect(() => {
    if (!show) return;
    const done = () => {
      setShow(false);
      try {
        localStorage.setItem(KEY, '1');
      } catch {
        /* ignore */
      }
    };
    const t = window.setTimeout(done, 14000);
    const unsub = useStore.subscribe((s, p) => {
      if (s.dynoActive !== p.dynoActive || s.config !== p.config) done();
    });
    window.addEventListener('keydown', done);
    return () => {
      window.clearTimeout(t);
      unsub();
      window.removeEventListener('keydown', done);
    };
  }, [show]);
  if (!show) return null;
  return (
    <div className="onboard" role="note" data-testid="onboarding">
      <div className="onboard-row">
        <kbd>D</kbd>
        <span>Dyno pull</span>
      </div>
      <div className="onboard-row">
        <kbd>Drag</kbd>
        <span>Orbit · scroll to zoom</span>
      </div>
      <div className="onboard-row">
        <kbd>Hover</kbd>
        <span>Inspect a cylinder</span>
      </div>
      <div className="onboard-row">
        <kbd>S</kbd>
        <span>Snapshot to compare</span>
      </div>
      <button className="onboard-x" onClick={() => { setShow(false); try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } }} aria-label="Dismiss tips">
        Got it
      </button>
    </div>
  );
}
