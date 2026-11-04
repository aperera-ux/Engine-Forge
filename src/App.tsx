import { useEffect } from 'react';
import { Header } from './ui/Header';
import { ConfigPanel } from './ui/ConfigPanel';
import { Viewport } from './ui/Viewport';
import { DynoCard } from './ui/DynoCard';
import { MiniCharts } from './ui/charts/MiniCharts';
import { KpiPanel, WarningsList } from './ui/Analytics';
import { useStore } from './ui/store';
import { cancelDynoPull, runDynoPull, startCrankClock } from './ui/dyno';
import './ui/app.css';

export default function App() {
  const collapsed = useStore((s) => s.panelCollapsed);
  useEffect(() => {
    startCrankClock();
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, select, textarea, [contenteditable]')) return;
      const s = useStore.getState();
      if (e.code === 'Space') {
        e.preventDefault();
        s.setRunning(!s.running);
      } else if (e.key === 'd' || e.key === 'D') {
        if (s.dynoActive) cancelDynoPull();
        else runDynoPull();
      } else if (e.key === 's' || e.key === 'S') {
        s.addSnapshot();
      } else if (e.key === '1' || e.key === '2' || e.key === '3') {
        s.setViewMode((['solid', 'cutaway', 'xray'] as const)[Number(e.key) - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className={`app ${collapsed ? 'cfg-collapsed' : ''}`}>
      <Header />
      <ConfigPanel />
      <Viewport />
      <aside className="panel side" data-testid="analytics">
        <KpiPanel />
        <WarningsList />
      </aside>
      <div className="bottom">
        <DynoCard />
        <section className="panel minis-card">
          <MiniCharts />
        </section>
      </div>
    </div>
  );
}
