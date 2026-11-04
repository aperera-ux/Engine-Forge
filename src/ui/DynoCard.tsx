import { useStore } from './store';
import { DynoChart, Delta } from './charts/DynoChart';
import { C, SNAP_COLORS } from './charts/common';
import { conv } from './units';

export function DynoCard() {
  const result = useStore((s) => s.result);
  const snapshots = useStore((s) => s.snapshots);
  const units = useStore((s) => s.units);
  const dyno = useStore((s) => s.dynoActive);
  const P = conv('power', units);
  const T = conv('torque', units);
  return (
    <section className="panel dyno-card" data-testid="dyno-card">
      <div className="panel-h">
        <span className="panel-title">
          Dyno
          {dyno && <span className="live-pill">Pull in progress</span>}
        </span>
        <div className="legend">
          <span className="lg">
            <i style={{ background: C.power }} />
            Power
          </span>
          <span className="lg">
            <i style={{ background: C.torque }} />
            Torque
          </span>
          {snapshots.map((s) => {
            const dp = P.to(result.peakPowerKw) - P.to(s.result.peakPowerKw);
            const dt = T.to(result.peakTorqueNm) - T.to(s.result.peakTorqueNm);
            return (
              <span className="lg snap" key={s.id} title={`Current vs ${s.name} (peak)`} data-testid="snapshot-delta">
                <i className="dash" style={{ color: SNAP_COLORS[s.slot] }} />
                <span className="ellipsis">{s.name}</span>
                <span className="lg-d">
                  Δ<Delta v={dp} unit={P.label} />
                  <Delta v={dt} unit={T.label} />
                </span>
              </span>
            );
          })}
        </div>
      </div>
      <DynoChart />
    </section>
  );
}
