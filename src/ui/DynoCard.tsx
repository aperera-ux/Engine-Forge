import { useState } from 'react';
import { hardwareDiff } from '../sim/customBuild';
import { useStore } from './store';
import { DynoChart, Delta } from './charts/DynoChart';
import { C, SNAP_COLORS } from './charts/common';
import { conv, fmt } from './units';
import { isCalibrationStale } from '../calibrate';
import { useCalib } from './calibrateStore';

/** Factory-limit status, hardware-only toggle and prediction-uncertainty badge. */
function DynoNotes() {
  const result = useStore((s) => s.result);
  const config = useStore((s) => s.config);
  const base = useStore((s) => s.basePreset);
  const show = useStore((s) => s.showUnlimited);
  const setShow = useStore((s) => s.setShowUnlimited);
  const units = useStore((s) => s.units);
  const [open, setOpen] = useState(false);
  const lim = result.oemLimits;
  const u = result.uncertainty;
  const P = conv('power', units);
  const T = conv('torque', units);
  const isPub = config.ecu?.limitSource === 'published-rating';
  const diffs = base ? hardwareDiff(config, base) : [];
  const limTxt = [
    lim.torqueLimitNm ? `torque capped at ${Math.round(T.to(lim.torqueLimitNm))} ${T.label}` : '',
    lim.powerLimitKw ? `power capped at ${Math.round(P.to(lim.powerLimitKw))} ${P.label}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const hasReasons = !!u && u.reasons.length > 0;
  const strong = !!u && u.extrapolation >= 0.5;
  const bandPct = u ? (u.peakHpPct ?? 0) : 0;
  const cal = useStore((s) => s.calibration);
  const calStale = !!cal && isCalibrationStale(config, cal);
  const linkNote = useStore((s) => s.calibrationLinkNote);
  const rangeTxt = (r: [number, number] | undefined, rpm: number) => (r && r[1] - r[0] > 1 ? `${fmt(r[0])}–${fmt(r[1])}` : fmt(rpm));
  const tPlateau = !!result.peakTorqueRpmRange && result.peakTorqueRpmRange[1] - result.peakTorqueRpmRange[0] > 1;
  const pPlateau = !!result.peakPowerRpmRange && result.peakPowerRpmRange[1] - result.peakPowerRpmRange[0] > 1;
  return (
    <div className="dyno-notes" data-testid="dyno-notes">
      {cal && (
        <span
          className={`dn-chip cal ${cal.verdict === 'poor' ? 'poor' : ''}`}
          data-testid="calibrated-badge"
          title={`Fitted to ${cal.sourceName}: RMS torque error ${cal.rmsBeforePct.toFixed(1)} % to ${cal.rmsAfterPct.toFixed(1)} %.${cal.verdict === 'poor' ? ' The fit stayed above 5 %.' : ''}${calStale ? ' The build was edited after the fit; the fitted corrections still apply.' : ''} The model's validation band does not apply to a fitted curve.`}
        >
          Calibrated to {cal.sourceName}
          <small>
            RMS {cal.rmsBeforePct.toFixed(1)} → {cal.rmsAfterPct.toFixed(1)} %{calStale ? ' · build edited since fit' : ''}
          </small>
        </span>
      )}
      {cal && linkNote && (
        <span className="dn-chip lim" data-testid="calibrated-link-note" title={linkNote}>
          {cal.measured.rpm.length < 2 ? 'Opened from link: no measured overlay' : 'Opened from link: overlay downsampled'}
        </span>
      )}
      {(tPlateau || pPlateau) && (
        <span className="dn-peaks" data-testid="dyno-peak-ranges">
          {tPlateau && (
            <span data-testid="peak-torque-range">
              Peak torque {fmt(T.to(result.peakTorqueNm))} {T.label} @ {rangeTxt(result.peakTorqueRpmRange, result.peakTorqueRpm)} rpm
            </span>
          )}
          {pPlateau && (
            <span data-testid="peak-power-range">
              Peak power {fmt(P.to(result.peakPowerKw))} {P.label} @ {rangeTxt(result.peakPowerRpmRange, result.peakPowerRpm)} rpm
            </span>
          )}
        </span>
      )}
      {lim.present && lim.applied && (
        <span className="dn-chip lim" data-testid="oem-limits-label" title={`The factory ECU in the published rating limits this stock engine: ${limTxt}.`}>
          Factory ECU limits (from published rating)
        </span>
      )}
      {lim.present && !lim.applied && (
        <span
          className="dn-chip off"
          data-testid="oem-limits-off"
          title={
            isPub
              ? `Hardware differs from stock${base ? ` ${base.name}` : ''}${diffs.length ? ` (${diffs.length} change${diffs.length > 1 ? 's' : ''})` : ''}, so the published torque/power rating no longer describes it.`
              : 'Limits are disabled.'
          }
        >
          Factory ECU limits off: custom build
        </span>
      )}
      {lim.present && lim.applied && (
        <label className="dn-toggle">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} data-testid="unlimited-toggle" />
          Show hardware-only curve (dashed)
        </label>
      )}
      {lim.present && lim.applied && show && result.unlimited && (
        <span className="dn-hint" data-testid="unlimited-hint">
          Dashed = hardware only: an upper bound under a safe tune, not validated against published curves.
        </span>
      )}
      {lim.present && lim.applied && !show && limTxt && (
        <span className="dn-hint">Stock ECU: {limTxt}.</span>
      )}
      {lim.present && !lim.applied && (
        <span className="dn-hint" data-testid="oem-limits-why">
          {isPub
            ? 'The published rating describes stock hardware; this build differs, so output is predicted from hardware alone.'
            : 'Limits are disabled.'}
        </span>
      )}
      <span className="dn-spacer" />
      {u && (
        <span className="dn-band" title="Shaded band: roughly 1σ model error from validation residuals against published figures">
          <i className="band-swatch" />
          Model band ±{bandPct.toFixed(0)}% at peak
        </span>
      )}
      {hasReasons && u && (
        <span className="dn-warn-wrap">
          <button
            className={`dn-badge ${strong ? 'strong' : ''}`}
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            data-testid="extrapolation-badge"
          >
            {strong ? 'Outside validated range' : 'Edge of validated range'}
          </button>
          {open && (
            <div className="dn-pop" role="dialog" data-testid="extrapolation-reasons">
              <b>Why the band is wide</b>
              <ul>
                {u.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              <small>Extrapolation score {u.extrapolation.toFixed(2)} (0 = inside the validated engines, 1 = far outside).</small>
            </div>
          )}
        </span>
      )}
    </div>
  );
}

export function DynoCard() {
  const result = useStore((s) => s.result);
  const snapshots = useStore((s) => s.snapshots);
  const units = useStore((s) => s.units);
  const dyno = useStore((s) => s.dynoActive);
  const measured = useCalib((s) => s.imported?.ok ?? false);
  const calName = useStore((s) => s.calibration?.sourceName);
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
          {(measured || calName) && (
            <span className="lg" data-testid="measured-legend" title="Measured dyno curve (crank basis, resampled)">
              <i className="dot" style={{ background: '#1f2937' }} />
              Measured
            </span>
          )}
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
      <DynoNotes />
      <DynoChart />
    </section>
  );
}
